import "server-only";

import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";

const DEFAULT_STORAGE_PATH = path.join(process.cwd(), "public", "uploads", "menu");
const storagePath = () => process.env.MENU_IMAGE_STORAGE_PATH || DEFAULT_STORAGE_PATH;
const externalPublicBaseUrl = () => process.env.MENU_IMAGE_PUBLIC_BASE_URL?.replace(/\/+$/, "") || "";
export type MenuImageType = "POS" | "QR_THUMBNAIL" | "QR_LARGE";
export type GeneratedMenuImage = { imageType: MenuImageType; imageUrl: string; fileName: string };

const isSafeFileName = (fileName: string) => /^(pos|qr|large)-[0-9a-f-]+\.webp$/i.test(fileName);

export function menuImageFilePath(menuId: number, fileName: string) {
  if (!Number.isInteger(menuId) || menuId <= 0 || !isSafeFileName(fileName)) throw new Error("Invalid menu image path");
  return path.join(storagePath(), String(menuId), fileName);
}

function menuImageUrl(menuId: number, fileName: string) {
  const externalBase = externalPublicBaseUrl();
  return externalBase ? externalBase + "/" + menuId + "/" + fileName : "/api/menu-images/" + menuId + "/" + fileName;
}

export async function generateMenuImages(menuId: number, source: Buffer) {
  if (!Number.isInteger(menuId) || menuId <= 0) throw new Error("Invalid menu");
  if (source.length === 0 || source.length > 10 * 1024 * 1024) throw new Error("이미지 파일은 10MB 이하여야 합니다.");

  const metadata = await sharp(source, { limitInputPixels: 40_000_000 }).metadata();
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format) || !metadata.width || !metadata.height) throw new Error("JPG, PNG, WebP 이미지 파일만 사용할 수 있습니다.");

  const version = randomUUID();
  const directory = path.join(storagePath(), String(menuId));
  const sizes: { imageType: MenuImageType; prefix: string; size: number; quality: number }[] = [
    { imageType: "POS", prefix: "pos", size: 200, quality: 84 },
    { imageType: "QR_THUMBNAIL", prefix: "qr", size: 600, quality: 88 },
    { imageType: "QR_LARGE", prefix: "large", size: 1200, quality: 90 },
  ];
  const generated = await Promise.all(sizes.map(async item => ({
    ...item,
    fileName: item.prefix + "-" + version + ".webp",
    buffer: await sharp(source, { limitInputPixels: 40_000_000 }).resize(item.size, item.size, { fit: "cover", position: "centre" }).webp({ quality: item.quality }).toBuffer(),
  })));

  await mkdir(directory, { recursive: true });
  try {
    await Promise.all(generated.map(item => writeFile(menuImageFilePath(menuId, item.fileName), item.buffer)));
  } catch (error) {
    await Promise.allSettled(generated.map(item => rm(menuImageFilePath(menuId, item.fileName), { force: true })));
    throw error;
  }
  return generated.map(item => ({ imageType: item.imageType, fileName: item.fileName, imageUrl: menuImageUrl(menuId, item.fileName) }));
}

export async function removeStoredMenuImages(menuId: number, imageUrls: string[]) {
  const externalBase = externalPublicBaseUrl();
  await Promise.allSettled(imageUrls.map(async imageUrl => {
    const prefix = externalBase ? externalBase + "/" + menuId + "/" : "/api/menu-images/" + menuId + "/";
    if (!imageUrl.startsWith(prefix)) return;
    const fileName = imageUrl.slice(prefix.length);
    if (isSafeFileName(fileName)) await rm(menuImageFilePath(menuId, fileName), { force: true });
  }));
}
