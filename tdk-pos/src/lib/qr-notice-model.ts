export const QR_NOTICE_LANGUAGES = ["ko", "en", "zh", "ja"] as const;
export type QrNoticeLanguage = typeof QR_NOTICE_LANGUAGES[number];
export type QrNoticeBlock =
  | { id: string; type: "text"; text: string; style: "paragraph" | "heading" | "bullet"; bold: boolean; highlight: boolean }
  | { id: string; type: "image"; assetId: string };
export type QrNoticeTranslation = { title: string; blocks: QrNoticeBlock[] };
export type QrNoticeTranslations = Partial<Record<QrNoticeLanguage, QrNoticeTranslation>>;
export type QrPublicNotice = { id: string; title: string; blocks: Array<Omit<Extract<QrNoticeBlock, { type: "image" }>, "assetId"> & { imageUrl: string } | Extract<QrNoticeBlock, { type: "text" }>> };

const NOTICE_ID_PATTERN = /^[1-9]\d{0,14}$/;
const ASSET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BLOCK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const QR_NOTICE_MAX_TITLE_LENGTH = 100;
export const QR_NOTICE_MAX_BLOCKS = 120;
export const QR_NOTICE_MAX_TEXT_LENGTH = 5000;
export const QR_NOTICE_MAX_SERIALIZED_LENGTH = 250_000;

export function isQrNoticeId(value: unknown): value is string {
  return typeof value === "string" && NOTICE_ID_PATTERN.test(value);
}

export function isQrNoticeAssetId(value: unknown): value is string {
  return typeof value === "string" && ASSET_ID_PATTERN.test(value);
}

export function isQrNoticeBlockId(value: unknown): value is string {
  return typeof value === "string" && BLOCK_ID_PATTERN.test(value);
}

function normalizeBlock(value: unknown): QrNoticeBlock | null {
  if (!value || typeof value !== "object") return null;
  const block = value as Record<string, unknown>;
  if (!isQrNoticeBlockId(block.id)) return null;
  if (block.type === "image") return isQrNoticeAssetId(block.assetId) ? { id: block.id, type: "image", assetId: block.assetId } : null;
  if (block.type !== "text" || typeof block.text !== "string" || block.text.length > QR_NOTICE_MAX_TEXT_LENGTH) return null;
  if (!(block.style === "paragraph" || block.style === "heading" || block.style === "bullet")) return null;
  return { id: block.id, type: "text", text: block.text, style: block.style, bold: block.bold === true, highlight: block.highlight === true };
}

export function normalizeQrNoticeTranslation(value: unknown): QrNoticeTranslation | null {
  if (!value || typeof value !== "object") return null;
  const translation = value as Record<string, unknown>;
  if (typeof translation.title !== "string") return null;
  const title = translation.title.trim();
  if (!title || title.length > QR_NOTICE_MAX_TITLE_LENGTH || !Array.isArray(translation.blocks) || translation.blocks.length > QR_NOTICE_MAX_BLOCKS) return null;
  const blocks = translation.blocks.map(normalizeBlock);
  if (blocks.some(block => block === null)) return null;
  const result = { title, blocks: blocks as QrNoticeBlock[] };
  return JSON.stringify(result).length <= QR_NOTICE_MAX_SERIALIZED_LENGTH ? result : null;
}

export function normalizeQrNoticeTranslations(value: unknown): QrNoticeTranslations | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const result: QrNoticeTranslations = {};
  for (const language of QR_NOTICE_LANGUAGES) {
    if (source[language] === undefined) continue;
    const translation = normalizeQrNoticeTranslation(source[language]);
    if (!translation) return null;
    result[language] = translation;
  }
  return result.ko ? result : null;
}

export function parseQrNoticeTranslations(value: string): QrNoticeTranslations | null {
  try { return normalizeQrNoticeTranslations(JSON.parse(value)); } catch { return null; }
}

export function serializeQrNoticeTranslations(value: QrNoticeTranslations): string {
  return JSON.stringify(value);
}

export function publicQrNotice(noticeId: number, translations: QrNoticeTranslations, language: string): QrPublicNotice | null {
  const translation = translations[language as QrNoticeLanguage] ?? translations.ko;
  if (!translation) return null;
  return {
    id: String(noticeId),
    title: translation.title,
    blocks: translation.blocks.map(block => block.type === "image"
      ? { id: block.id, type: "image" as const, imageUrl: `/api/qr/notices/images/${block.assetId}` }
      : block),
  };
}

export function noticeImageAssetIds(value: QrNoticeTranslations): string[] {
  return [...new Set(Object.values(value).flatMap(translation => translation?.blocks.flatMap(block => block.type === "image" ? [block.assetId] : []) ?? []))];
}
