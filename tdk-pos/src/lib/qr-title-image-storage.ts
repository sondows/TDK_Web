import "server-only";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { isQrTitleId, isQrTitleCrop, type QrTitleCrop } from "@/lib/qr-title-model";

const STORAGE_PATH = () => process.env.QR_TITLE_IMAGE_STORAGE_PATH || path.join(process.cwd(), ".pos-runtime", "qr-title");
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;

function assetPath(assetId: string, source: boolean) {
  if (!isQrTitleId(assetId)) throw new Error("Invalid QR title image id");
  return path.join(/*turbopackIgnore: true*/ STORAGE_PATH(), `${assetId}${source ? "-source" : ""}${source ? "" : ".webp"}`);
}

export async function saveQrTitleImageAssets(assetId: string, source: Buffer, cropped: Buffer, crop: QrTitleCrop) {
  if (!isQrTitleId(assetId) || !isQrTitleCrop(crop)) throw new Error("Invalid QR title image data");
  if (!source.length || source.length > MAX_FILE_BYTES || !cropped.length || cropped.length > MAX_FILE_BYTES) {
    throw new Error("사진 파일은 각각 10MB 이하여야 합니다.");
  }

  const sourceInput = sharp(source, { limitInputPixels: MAX_PIXELS });
  const inputMetadata = await sourceInput.metadata();
  if (!inputMetadata.format || !["jpeg", "png", "webp"].includes(inputMetadata.format) || !inputMetadata.width || !inputMetadata.height || inputMetadata.width * inputMetadata.height > MAX_PIXELS) {
    throw new Error("JPG, PNG, WebP 사진만 사용할 수 있습니다.");
  }
  const sourceImage = sharp(source, { limitInputPixels: MAX_PIXELS }).rotate();
  const cropImage = sharp(cropped, { limitInputPixels: MAX_PIXELS }).rotate();
  const normalizedSource = await sourceImage.webp({ quality: 94 }).toBuffer();
  const sourceMetadata = await sharp(normalizedSource).metadata();
  const cropMetadata = await cropImage.metadata();
  if (!sourceMetadata.format || sourceMetadata.format !== "webp" ||
    !cropMetadata.format || !["jpeg", "png", "webp"].includes(cropMetadata.format) ||
    !sourceMetadata.width || !sourceMetadata.height || !cropMetadata.width || !cropMetadata.height ||
    sourceMetadata.width * sourceMetadata.height > MAX_PIXELS || cropMetadata.width * cropMetadata.height > MAX_PIXELS) {
    throw new Error("JPG, PNG, WebP 사진만 사용할 수 있습니다.");
  }
  if (crop.sourceWidth !== sourceMetadata.width || crop.sourceHeight !== sourceMetadata.height ||
    Math.abs(crop.width / crop.height - 4 / 3) > 0.04) {
    throw new Error("사진 자르기 정보가 올바르지 않습니다. 다시 선택해 주세요.");
  }

  const titleImage = await cropImage.resize(1200, 900, { fit: "cover", position: "centre" }).webp({ quality: 90 }).toBuffer();
  const directory = STORAGE_PATH();
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(assetPath(assetId, true), source, { flag: "wx" });
    await writeFile(assetPath(assetId, false), titleImage, { flag: "wx" });
  } catch (error) {
    await Promise.allSettled([rm(assetPath(assetId, true), { force: true }), rm(assetPath(assetId, false), { force: true })]);
    throw error;
  }
}

export async function readQrTitleImage(assetId: string, source = false) {
  return readFile(assetPath(assetId, source));
}

export async function qrTitleImageContentType(bytes: Buffer) {
  const format = (await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata()).format;
  if (format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  throw new Error("Unsupported QR title image format");
}

export async function removeQrTitleImageAssets(assetId: string) {
  if (!isQrTitleId(assetId)) return;
  await Promise.allSettled([rm(assetPath(assetId, true), { force: true }), rm(assetPath(assetId, false), { force: true })]);
}
