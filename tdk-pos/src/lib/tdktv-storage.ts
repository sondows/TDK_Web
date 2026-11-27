import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { isAllowedTvUploadName, isSafeTvStoredName, TV_IMAGE_LIMIT_BYTES, TV_MAX_PIXELS } from "@/lib/tdktv-policy";

export const TV_IMAGE_MAX_BYTES = TV_IMAGE_LIMIT_BYTES;
const root = () => process.env.TDKTV_IMAGE_STORAGE_PATH || path.join(process.cwd(), ".pos-runtime", "tdktv-images");

export function tvImagePath(screenId: number, storedName: string) {
  if (!Number.isSafeInteger(screenId) || screenId < 1 || !isSafeTvStoredName(storedName)) throw new Error("Invalid TV image path");
  return path.join(/*turbopackIgnore: true*/ root(), String(screenId), storedName);
}

export async function saveTvImage(screenId: number, originalName: string, source: Buffer) {
  if (!source.length || source.length > TV_IMAGE_MAX_BYTES) throw new Error("이미지는 10MB 이하로 등록해 주세요.");
  const safeName = path.win32.basename(path.posix.basename(originalName)).replace(/[\x00-\x1f\x7f]/g, "").slice(0, 255);
  if (!isAllowedTvUploadName(safeName)) throw new Error("JPG, PNG, WebP 파일만 등록할 수 있습니다.");
  const metadata = await sharp(source, { limitInputPixels: TV_MAX_PIXELS, failOn: "error" }).metadata();
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > TV_MAX_PIXELS || !["jpeg", "png", "webp"].includes(metadata.format ?? ""))
    throw new Error("이미지 내용을 확인할 수 없습니다.");
  const format = metadata.format as "jpeg" | "png" | "webp";
  const expected = format === "jpeg" ? /\.jpe?g$/i : new RegExp(`\\.${format}$`, "i");
  if (!expected.test(safeName)) throw new Error("파일 확장자와 이미지 내용이 다릅니다.");
  const mimeType = format === "jpeg" ? "image/jpeg" : `image/${format}`;
  const ext = format === "jpeg" ? "jpg" : format;
  const encoded = await sharp(source, { limitInputPixels: TV_MAX_PIXELS }).rotate().toFormat(format).toBuffer();
  if (encoded.length > TV_IMAGE_MAX_BYTES) throw new Error("처리된 이미지가 10MB를 초과합니다.");
  const dimensions = await sharp(encoded).metadata();
  const storedName = `${randomUUID()}.${ext}`;
  const target = tvImagePath(screenId, storedName);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, encoded, { flag: "wx" });
  return { originalName: safeName || "image", storedName, mimeType, fileSize: encoded.length,
    width: dimensions.width!, height: dimensions.height! };
}

export async function readTvImage(screenId: number, storedName: string) {
  try { return await readFile(tvImagePath(screenId, storedName)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function removeTvImage(screenId: number, storedName: string) {
  await rm(tvImagePath(screenId, storedName), { force: true });
}

export async function quarantineTvImage(screenId: number, storedName: string) {
  const source = tvImagePath(screenId, storedName);
  const quarantined = `${source}.deleting`;
  await rename(source, quarantined);
  return { restore: () => rename(quarantined, source), purge: () => rm(quarantined, { force: true }) };
}
