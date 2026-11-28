import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { DEFAULT_QR_AUTH_GUIDE, qrAuthGuideAssetId, qrAuthGuideImageUrl } from "@/lib/qr-auth-guide-model";
import { encodeQrGuideImage } from "@/lib/qr-notice-image-storage";

const titleKey = "qr.order-auth-guide.title";
const messageKey = "qr.order-auth-guide.message";
const photoKey = "qr.order-auth-guide.photo";
const storageDirectory = () => path.join(/*turbopackIgnore: true*/
  process.env.QR_NOTICE_IMAGE_STORAGE_PATH || path.join(process.cwd(), ".pos-runtime", "qr-notices"), "order-auth-guide");
const imagePath = (assetId: string) => path.join(/*turbopackIgnore: true*/ storageDirectory(), `${assetId}.webp`);

export async function getQrAuthGuide() {
  const rows = await db.select().from(systemSettings).where(inArray(systemSettings.settingKey, [titleKey, messageKey, photoKey]));
  const values = new Map(rows.map(row => [row.settingKey, row.settingValue]));
  const assetId = values.get(photoKey);
  return {
    title: values.get(titleKey)?.trim() || DEFAULT_QR_AUTH_GUIDE.title,
    message: values.get(messageKey)?.trim() || DEFAULT_QR_AUTH_GUIDE.message,
    imageUrl: assetId && qrAuthGuideAssetId.test(assetId) ? qrAuthGuideImageUrl(assetId) : null,
  };
}

export async function readQrAuthGuideImage(assetId: string) {
  if (!qrAuthGuideAssetId.test(assetId)) return null;
  return readFile(imagePath(assetId)).catch(() => null);
}

async function removeGuideImage(assetId: string) {
  if (qrAuthGuideAssetId.test(assetId)) {
    await rm(imagePath(assetId), { force: true }).catch(error => console.error("QR guide image cleanup failed", error));
  }
}

export async function saveQrAuthGuide(text: { title: string; message: string }, photo: Buffer | "remove" | "keep") {
  const assetId = Buffer.isBuffer(photo) ? randomUUID() : "";
  if (Buffer.isBuffer(photo)) {
    const image = await encodeQrGuideImage(photo).catch(cause => {
      const error = new Error("Invalid QR guide photo", { cause });
      error.name = "QrAuthGuideImageError";
      throw error;
    });
    await mkdir(storageDirectory(), { recursive: true });
    await writeFile(imagePath(assetId), image, { flag: "wx" });
  }

  let previous = "";
  let selected = "";
  try {
    await db.transaction(async tx => {
      await tx.insert(systemSettings).values({ settingKey: photoKey, settingValue: "" })
        .onDuplicateKeyUpdate({ set: { settingKey: photoKey } });
      const [current] = await tx.select({ value: systemSettings.settingValue }).from(systemSettings)
        .where(eq(systemSettings.settingKey, photoKey)).for("update");
      previous = current?.value ?? "";
      selected = photo === "keep" ? previous : assetId;
      for (const [settingKey, settingValue] of [[titleKey, text.title], [messageKey, text.message], [photoKey, selected]]) {
        await tx.insert(systemSettings).values({ settingKey, settingValue }).onDuplicateKeyUpdate({ set: { settingValue } });
      }
    });
  } catch (error) {
    await removeGuideImage(assetId);
    throw error;
  }
  if (selected !== previous) await removeGuideImage(previous);
  return { ...text, imageUrl: selected && qrAuthGuideAssetId.test(selected) ? qrAuthGuideImageUrl(selected) : null };
}
