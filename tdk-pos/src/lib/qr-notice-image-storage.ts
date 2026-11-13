import "server-only";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { isQrNoticeAssetId } from "@/lib/qr-notice-model";

const storagePath = () => process.env.QR_NOTICE_IMAGE_STORAGE_PATH || path.join(process.cwd(), ".pos-runtime", "qr-notices");
export const QR_NOTICE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;

function imagePath(assetId: string) {
  if (!isQrNoticeAssetId(assetId)) throw new Error("Invalid QR notice image id");
  return path.join(/*turbopackIgnore: true*/ storagePath(), `${assetId}.webp`);
}

export async function saveQrNoticeImage(assetId: string, source: Buffer) {
  if (!isQrNoticeAssetId(assetId)) throw new Error("이미지 식별값이 올바르지 않습니다.");
  if (!source.length || source.length > QR_NOTICE_IMAGE_MAX_BYTES) throw new Error("이미지는 10MB 이하로 등록해 주세요.");
  const pipeline = sharp(source, { limitInputPixels: MAX_PIXELS });
  const metadata = await pipeline.metadata();
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format) || !metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS) {
    throw new Error("JPG, PNG, WebP 이미지 파일만 등록할 수 있습니다.");
  }
  const output = await sharp(source, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
  await mkdir(storagePath(), { recursive: true });
  await writeFile(imagePath(assetId), output, { flag: "wx" });
  return { assetId, imageUrl: `/api/qr/notices/images/${assetId}` };
}

export async function readQrNoticeImage(assetId: string) {
  if (!isQrNoticeAssetId(assetId)) return null;
  try { return await readFile(imagePath(assetId)); } catch { return null; }
}

export async function removeQrNoticeImage(assetId: string) {
  if (!isQrNoticeAssetId(assetId)) return;
  await rm(imagePath(assetId), { force: true });
}
