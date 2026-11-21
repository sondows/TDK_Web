export const QR_TITLE_SETTING_PREFIX = "qr_title_photo_";
export const QR_TITLE_SUBTITLE_SETTING_KEY = "qr_title_subtitle";
export const QR_TITLE_SCREEN_IDS = ["order_history", "order"] as const;
export type QrTitleScreenId = typeof QR_TITLE_SCREEN_IDS[number];
export type QrTitleLeftMode = "SHARE_QR" | "TEXT" | "HIDE";
export type QrTitleRightMode = "TABLE_NO" | "TEXT" | "HIDE";
export type QrTitleFooterMode = "BUSINESS_HOURS" | "TEXT" | "HIDE";
export type QrTitleScreenSettings = {
  title: string;
  leftMode: QrTitleLeftMode;
  leftText: string;
  rightMode: QrTitleRightMode;
  rightText: string;
  footerMode: QrTitleFooterMode;
  footerText: string;
};
export type QrTitleScreenSettingField = keyof QrTitleScreenSettings;
const QR_TITLE_SCREEN_PHOTO_CONFIGURED_PREFIX = "qr_title_screen_photos_";
export const QR_TITLE_SUBTITLE_MAX_LENGTH = 40;
export const QR_TITLE_ASPECT_RATIO = 4 / 3;
export const QR_TITLE_AUTOPLAY_MS = 3000;
export const QR_TITLE_HERO_OVERLAP_MIN_PX = 32;
export const QR_TITLE_HERO_OVERLAP_MAX_PX = 40;
export const QR_TITLE_HERO_OVERLAP_WIDTH_RATIO = 0.08;
export function qrTitleHeroOverlap(widthPx: number): number {
  return Math.min(QR_TITLE_HERO_OVERLAP_MAX_PX,
    Math.max(QR_TITLE_HERO_OVERLAP_MIN_PX, widthPx * QR_TITLE_HERO_OVERLAP_WIDTH_RATIO));
}

export function qrTitleInitialCardTop(heroHeightPx: number): number {
  return Math.max(0, heroHeightPx * 0.5);
}

export function qrTitleInitialScroll(heroHeightPx: number, overlapPx: number, cardTopPx = heroHeightPx / 2): number {
  return Math.max(0, heroHeightPx - overlapPx - cardTopPx);
}

export type QrTitleCrop = { x: number; y: number; width: number; height: number; sourceWidth: number; sourceHeight: number };
export type QrTitlePhoto = {
  photoId: string;
  assetId: string;
  sortOrder: number;
  isActive: boolean;
  crop: QrTitleCrop;
  screenId?: QrTitleScreenId;
};
export type QrTitleSlide = { id: string; imageUrl: string; alt: string };
export type QrPublicTitleSettings = {
  photos: QrTitleSlide[];
  screenSettings?: QrTitleScreenSettings;
  storeName: string;
  subtitle: string;
  weekly: import("@/lib/qr-business-hours").BusinessHours[];
  specialHours: import("@/lib/qr-business-hours").SpecialBusinessHours[];
  businessHoursMode: import("@/lib/qr-business-hours").BusinessHoursMode;
  closedDates: import("@/lib/qr-business-hours").BusinessDateClosure[];
  holidayRules: import("@/lib/qr-business-hours").BusinessHolidayRule[];
  kasiHolidays: import("@/lib/kasi-holiday-model").KasiHoliday[];
  todayOverride: import("@/lib/qr-business-hours").TodayBusinessOverride | null;
  serverNow: string;
};

export function emptyQrPublicTitleSettings(now = new Date()): QrPublicTitleSettings {
  return { photos: [], storeName: "", subtitle: "", weekly: Array.from({ length: 7 }, () => ({ closed: false, openTime: "", closeTime: "", breakStart: "", breakEnd: "", allDay: false })), specialHours: [], businessHoursMode: "WEEKLY", closedDates: [], holidayRules: [], kasiHolidays: [], todayOverride: null, serverNow: now.toISOString() };
}

export function isQrTitleScreenId(value: unknown): value is QrTitleScreenId {
  return typeof value === "string" && QR_TITLE_SCREEN_IDS.includes(value as QrTitleScreenId);
}

export function defaultQrTitleScreenSettings(screenId: QrTitleScreenId, legacyStoreName = ""): QrTitleScreenSettings {
  return {
    title: screenId === "order" ? "주문하기" : legacyStoreName.trim() || "탑동김치찌개",
    leftMode: screenId === "order" ? "SHARE_QR" : "HIDE",
    leftText: "",
    rightMode: screenId === "order" ? "TABLE_NO" : "HIDE",
    rightText: "",
    footerMode: "BUSINESS_HOURS",
    footerText: "",
  };
}

export function qrTitleScreenSettingKey(screenId: QrTitleScreenId, field: QrTitleScreenSettingField): string {
  if (!isQrTitleScreenId(screenId)) throw new Error("Invalid QR title screen");
  return `qr_title_screen_${screenId}_${field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}`;
}

export function qrTitleScreenPhotosConfiguredKey(screenId: QrTitleScreenId): string {
  if (!isQrTitleScreenId(screenId)) throw new Error("Invalid QR title screen");
  return `${QR_TITLE_SCREEN_PHOTO_CONFIGURED_PREFIX}${screenId}`;
}

export function normalizeQrTitleScreenText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return [...text].length <= maxLength && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
}

export function normalizeQrTitleScreenSettings(value: unknown): QrTitleScreenSettings | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<QrTitleScreenSettings>;
  const title = normalizeQrTitleScreenText(input.title, 60);
  const leftText = normalizeQrTitleScreenText(input.leftText, 40);
  const rightText = normalizeQrTitleScreenText(input.rightText, 40);
  const footerText = normalizeQrTitleScreenText(input.footerText, 60);
  if (title === null || !title || leftText === null || rightText === null || footerText === null) return null;
  if (!(input.leftMode === "SHARE_QR" || input.leftMode === "TEXT" || input.leftMode === "HIDE")) return null;
  if (!(input.rightMode === "TABLE_NO" || input.rightMode === "TEXT" || input.rightMode === "HIDE")) return null;
  if (!(input.footerMode === "BUSINESS_HOURS" || input.footerMode === "TEXT" || input.footerMode === "HIDE")) return null;
  if (input.leftMode === "TEXT" && !leftText || input.rightMode === "TEXT" && !rightText || input.footerMode === "TEXT" && !footerText) return null;
  return { title, leftMode: input.leftMode, leftText, rightMode: input.rightMode, rightText, footerMode: input.footerMode, footerText };
}

export function normalizeQrTitleSubtitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const subtitle = value.trim();
  if ([...subtitle].length > QR_TITLE_SUBTITLE_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(subtitle)) return null;
  return subtitle;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isQrTitleId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isQrTitleCrop(value: unknown): value is QrTitleCrop {
  if (!value || typeof value !== "object") return false;
  const crop = value as Partial<QrTitleCrop>;
  return [crop.x, crop.y, crop.width, crop.height, crop.sourceWidth, crop.sourceHeight].every(Number.isSafeInteger) &&
    Number(crop.x) >= 0 && Number(crop.y) >= 0 && Number(crop.width) > 0 && Number(crop.height) > 0 &&
    Number(crop.sourceWidth) > 0 && Number(crop.sourceHeight) > 0 &&
    Number(crop.width) <= Number(crop.sourceWidth) && Number(crop.height) <= Number(crop.sourceHeight) &&
    Number(crop.x) + Number(crop.width) <= Number(crop.sourceWidth) &&
    Number(crop.y) + Number(crop.height) <= Number(crop.sourceHeight);
}

/** Compact encoding fits one photo's metadata in the existing system_settings varchar(255). */
export function serializeQrTitlePhoto(photo: QrTitlePhoto): string {
  if (!isQrTitleId(photo.photoId) || !isQrTitleId(photo.assetId) || !Number.isSafeInteger(photo.sortOrder) ||
    photo.sortOrder < 0 || typeof photo.isActive !== "boolean" || !isQrTitleCrop(photo.crop)) {
    throw new Error("Invalid QR title photo settings");
  }
  const value = JSON.stringify({ a: photo.assetId, o: photo.sortOrder, n: photo.isActive, c: [
    photo.crop.x, photo.crop.y, photo.crop.width, photo.crop.height, photo.crop.sourceWidth, photo.crop.sourceHeight,
  ] });
  if (value.length > 255) throw new Error("QR title photo settings exceed the existing database field");
  return value;
}

export function parseQrTitlePhoto(settingKey: string, settingValue: string): QrTitlePhoto | null {
  let screenId: QrTitleScreenId | undefined;
  let photoId = "";
  for (const candidate of QR_TITLE_SCREEN_IDS) {
    const prefix = `${QR_TITLE_SETTING_PREFIX}${candidate}_`;
    if (settingKey.startsWith(prefix)) {
      screenId = candidate;
      photoId = settingKey.slice(prefix.length);
      break;
    }
  }
  if (!photoId && settingKey.startsWith(QR_TITLE_SETTING_PREFIX)) photoId = settingKey.slice(QR_TITLE_SETTING_PREFIX.length);
  if (!isQrTitleId(photoId)) return null;
  try {
    const value = JSON.parse(settingValue) as { a?: unknown; o?: unknown; n?: unknown; c?: unknown };
    if (!isQrTitleId(value.a) || !Number.isSafeInteger(value.o) || Number(value.o) < 0 || typeof value.n !== "boolean" ||
      !Array.isArray(value.c) || value.c.length !== 6 || !value.c.every(Number.isSafeInteger)) return null;
    const [x, y, width, height, sourceWidth, sourceHeight] = value.c as number[];
    const crop = { x, y, width, height, sourceWidth, sourceHeight };
    if (!isQrTitleCrop(crop)) return null;
    return { photoId, assetId: value.a, sortOrder: Number(value.o), isActive: value.n, crop, ...(screenId ? { screenId } : {}) };
  } catch {
    return null;
  }
}

export function qrTitlePhotoSettingKey(photoId: string, screenId?: QrTitleScreenId): string {
  if (!isQrTitleId(photoId)) throw new Error("Invalid QR title photo id");
  if (screenId !== undefined && !isQrTitleScreenId(screenId)) throw new Error("Invalid QR title screen");
  return `${QR_TITLE_SETTING_PREFIX}${screenId ? `${screenId}_` : ""}${photoId}`;
}

export function orderedQrTitlePhotos(photos: readonly QrTitlePhoto[]): QrTitlePhoto[] {
  return [...photos].sort((a, b) => a.sortOrder - b.sortOrder || a.photoId.localeCompare(b.photoId));
}
