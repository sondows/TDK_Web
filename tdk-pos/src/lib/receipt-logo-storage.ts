import "server-only";

import { randomUUID } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";

export const receiptLogoSettingKey = "receipt_logo_file";
export const receiptLogoMaxWidth = 480;
export const receiptLogoMaxHeight = 120;
const maxUploadBytes = 4 * 1024 * 1024;
const storagePath = () => process.env.RECEIPT_LOGO_STORAGE_PATH || path.join(process.cwd(), "storage", "receipt-logo");

function logoPath(fileName: string) {
  if (!/^logo-[0-9a-f-]{36}\.png$/i.test(fileName)) throw new Error("Invalid receipt logo file name");
  return path.join(/*turbopackIgnore: true*/ storagePath(), fileName);
}

export async function getReceiptLogoFileName(): Promise<string | null> {
  const [row] = await db.select({ value: systemSettings.settingValue })
    .from(systemSettings).where(eq(systemSettings.settingKey, receiptLogoSettingKey)).limit(1);
  return row?.value && /^logo-[0-9a-f-]{36}\.png$/i.test(row.value) ? row.value : null;
}

export async function saveReceiptLogo(file: File): Promise<string> {
  if (!file.size || file.size > maxUploadBytes) throw new Error("로고 이미지는 4MB 이하여야 합니다.");
  const source = Buffer.from(await file.arrayBuffer());
  const metadata = await sharp(source, { limitInputPixels: 20_000_000 }).metadata();
  if (!metadata.width || !metadata.height || !["png", "jpeg"].includes(metadata.format ?? ""))
    throw new Error("PNG 또는 JPG 이미지만 사용할 수 있습니다.");

  const normalized = await sharp(source, { limitInputPixels: 20_000_000 })
    .rotate()
    .resize(receiptLogoMaxWidth, receiptLogoMaxHeight, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .greyscale()
    .threshold(160)
    .png()
    .toBuffer();
  const fileName = `logo-${randomUUID()}.png`;
  await mkdir(storagePath(), { recursive: true });
  await writeFile(logoPath(fileName), normalized, { flag: "wx" });
  return fileName;
}

export async function readReceiptLogo(fileName: string): Promise<Buffer> {
  return readFile(/*turbopackIgnore: true*/ logoPath(fileName));
}

export async function removeReceiptLogo(fileName: string): Promise<void> {
  await rm(logoPath(fileName), { force: true });
}

export async function getReceiptLogoRaster(): Promise<{ width: number; height: number; pixelsBase64: string } | null> {
  try {
    const fileName = await getReceiptLogoFileName();
    if (!fileName) return null;
    const { data, info } = await sharp(await readReceiptLogo(fileName)).greyscale().raw().toBuffer({ resolveWithObject: true });
    if (info.width > receiptLogoMaxWidth || info.height > receiptLogoMaxHeight || info.channels !== 1) return null;
    return { width: info.width, height: info.height, pixelsBase64: data.toString("base64") };
  } catch (error) {
    console.error("receipt logo load failed; using store name", error);
    return null;
  }
}
