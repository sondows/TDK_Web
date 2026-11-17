export const QR_MENU_DESCRIPTION_LOCALE = "ko" as const;
export const QR_MENU_SHORT_DESCRIPTION_LIMIT = 1000;
export const QR_MENU_DETAIL_DESCRIPTION_LIMIT = 10000;
export const QR_MENU_ORIGIN_DESCRIPTION_LIMIT = 10000;
const QR_ORIGIN_DOCUMENT_STORAGE_LIMIT = 60000;
const QR_ORIGIN_DOCUMENT_PREFIX = "\u001eTDKON_ORIGIN_RICH_V1:";

export type QrOriginBoldRange = [start: number, end: number];
export type QrOriginDocument = { text: string; boldRanges: QrOriginBoldRange[] };

function normalizeBoldRanges(text: string, ranges: unknown): QrOriginBoldRange[] {
  if (!Array.isArray(ranges)) return [];
  const valid = ranges.flatMap(range => {
    if (!Array.isArray(range) || range.length !== 2) return [];
    const [start, end] = range;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > text.length || start >= end) return [];
    return [[start, end] as QrOriginBoldRange];
  }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: QrOriginBoldRange[] = [];
  for (const [start, end] of valid) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export function decodeQrOriginDocument(value: string): QrOriginDocument {
  if (!value.startsWith(QR_ORIGIN_DOCUMENT_PREFIX)) return { text: value, boldRanges: [] };
  try {
    const parsed: unknown = JSON.parse(value.slice(QR_ORIGIN_DOCUMENT_PREFIX.length));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { text: value, boldRanges: [] };
    const document = parsed as Record<string, unknown>;
    if (document.version !== 1 || typeof document.text !== "string") return { text: value, boldRanges: [] };
    return { text: document.text, boldRanges: normalizeBoldRanges(document.text, document.boldRanges) };
  } catch {
    return { text: value, boldRanges: [] };
  }
}

export function encodeQrOriginDocument(document: QrOriginDocument): string {
  const boldRanges = normalizeBoldRanges(document.text, document.boldRanges);
  return `${QR_ORIGIN_DOCUMENT_PREFIX}${JSON.stringify({ version: 1, text: document.text, boldRanges })}`;
}

export function qrOriginTextRuns(value: string): Array<{ text: string; bold: boolean }> {
  const document = decodeQrOriginDocument(value);
  const runs: Array<{ text: string; bold: boolean }> = [];
  let rangeIndex = 0;
  let index = 0;
  while (index < document.text.length) {
    while (rangeIndex < document.boldRanges.length && document.boldRanges[rangeIndex][1] <= index) rangeIndex += 1;
    const range = document.boldRanges[rangeIndex];
    const bold = Boolean(range && range[0] <= index && index < range[1]);
    const nextIndex = range ? (bold ? range[1] : range[0]) : document.text.length;
    const end = Math.max(index + 1, nextIndex);
    const text = document.text.slice(index, end);
    const previous = runs.at(-1);
    if (previous?.bold === bold) previous.text += text;
    else runs.push({ text, bold });
    index = end;
  }
  return runs;
}

export function qrOriginHasDisplayText(value: string | null | undefined): boolean {
  if (!value) return false;
  const text = decodeQrOriginDocument(value).text
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
  return text.trim().length > 0;
}

export type QrMenuDescriptionDraft = {
  shortDescription: string;
  detailDescription: string;
  originDescription: string;
};

export type QrMenuDescriptionInput = QrMenuDescriptionDraft;

export function parseQrMenuDescriptionInput(value: unknown): QrMenuDescriptionInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.shortDescription !== "string" || typeof body.detailDescription !== "string" || typeof body.originDescription !== "string") return null;

  const shortDescription = body.shortDescription;
  const detailDescription = body.detailDescription.trim();
  const originDescription = body.originDescription;
  if (originDescription.length > QR_ORIGIN_DOCUMENT_STORAGE_LIMIT) return null;
  if (new TextEncoder().encode(originDescription).byteLength > QR_ORIGIN_DOCUMENT_STORAGE_LIMIT) return null;
  const originDocument = decodeQrOriginDocument(originDescription);
  if (shortDescription.length > QR_MENU_SHORT_DESCRIPTION_LIMIT
    || detailDescription.length > QR_MENU_DETAIL_DESCRIPTION_LIMIT
    || originDocument.text.length > QR_MENU_ORIGIN_DESCRIPTION_LIMIT) return null;

  return { shortDescription, detailDescription, originDescription };
}

export function qrMenuDescriptionStatus(record: QrMenuDescriptionDraft) {
  const completed = [
    Boolean(record.shortDescription.trim()),
    Boolean(record.detailDescription.trim()),
    Boolean(decodeQrOriginDocument(record.originDescription).text.trim()),
  ].filter(Boolean).length;
  return completed === 0 ? "미작성" : completed === 3 ? "작성 완료" : "일부 작성";
}
