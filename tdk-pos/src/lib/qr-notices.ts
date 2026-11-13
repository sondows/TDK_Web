import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { qrNotices } from "@/db/schema";
import { normalizeQrNoticeTranslations, parseQrNoticeTranslations, publicQrNotice, type QrNoticeTranslations } from "@/lib/qr-notice-model";
import { removeQrNoticeImage } from "@/lib/qr-notice-image-storage";

export type QrNoticeRecord = { noticeId: number; translations: QrNoticeTranslations; isActive: boolean; sortOrder: number; createdAt: Date; updatedAt: Date };

export async function listQrNotices(includeInactive = true): Promise<QrNoticeRecord[]> {
  const rows = await db.select().from(qrNotices).orderBy(asc(qrNotices.sortOrder), asc(qrNotices.noticeId));
  return rows.flatMap(row => {
    const translations = parseQrNoticeTranslations(row.translationsJson);
    return translations ? [{ noticeId: row.noticeId, translations, isActive: row.isActive === 1, sortOrder: row.sortOrder, createdAt: row.createdAt, updatedAt: row.updatedAt }] : [];
  }).filter(row => includeInactive || row.isActive);
}

export async function listPublicQrNotices(language = "ko") {
  const notices = await listQrNotices(false);
  return notices.flatMap(notice => {
    const publicNotice = publicQrNotice(notice.noticeId, notice.translations, language);
    return publicNotice ? [publicNotice] : [];
  });
}

export function normalizeNoticePayload(value: unknown): QrNoticeTranslations | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (body.translations !== undefined) return normalizeQrNoticeTranslations(body.translations);
  return normalizeQrNoticeTranslations({ ko: { title: body.title, blocks: body.blocks } });
}

export async function removeUnusedNoticeImages(candidateAssetIds: string[]) {
  const ids = [...new Set(candidateAssetIds)];
  if (!ids.length) return;
  const rows = await db.select({ translationsJson: qrNotices.translationsJson }).from(qrNotices);
  const parsed = rows.map(row => parseQrNoticeTranslations(row.translationsJson));
  if (parsed.some(translations => !translations)) return;
  const used = new Set(parsed.flatMap(translations => Object.values(translations!).flatMap(translation => translation?.blocks.flatMap(block => block.type === "image" ? [block.assetId] : []) ?? [])));
  await Promise.all(ids.filter(id => !used.has(id)).map(id => removeQrNoticeImage(id)));
}

export async function getQrNoticeRecord(noticeId: number) {
  const [row] = await db.select().from(qrNotices).where(eq(qrNotices.noticeId, noticeId)).limit(1);
  if (!row) return null;
  const translations = parseQrNoticeTranslations(row.translationsJson);
  return translations ? { noticeId: row.noticeId, translations, isActive: row.isActive === 1, sortOrder: row.sortOrder, createdAt: row.createdAt, updatedAt: row.updatedAt } satisfies QrNoticeRecord : null;
}
