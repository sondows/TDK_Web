import "server-only";

import { asc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { QR_TITLE_SETTING_PREFIX, QR_TITLE_SUBTITLE_SETTING_KEY, defaultQrTitleScreenSettings, orderedQrTitlePhotos, parseQrTitlePhoto, qrTitlePhotoSettingKey, qrTitleScreenPhotosConfiguredKey, qrTitleScreenSettingKey, type QrTitlePhoto, type QrTitleScreenId, type QrTitleScreenSettingField, type QrTitleScreenSettings } from "@/lib/qr-title-model";
import {
  businessHoursSettingKey, parseBusinessDateClosure, parseBusinessHolidayRule, parseBusinessHours, parseBusinessHoursMode,
  getBusinessOperatingDate, parseTodayBusinessOverride, QR_BUSINESS_CLOSURE_PREFIX, QR_BUSINESS_HOLIDAY_PREFIX,
  QR_BUSINESS_MODE_KEY, QR_BUSINESS_SPECIAL_PREFIX, QR_BUSINESS_TODAY_OVERRIDE_KEY, EMPTY_BUSINESS_HOURS,
  type BusinessDateClosure, type BusinessHolidayRule, type BusinessHoursMode, type SpecialBusinessHours,
} from "@/lib/qr-business-hours";
import { getStoreInfo } from "@/lib/store-info";
import { listKasiHolidays } from "@/lib/kasi-holiday-service";

export async function listQrTitlePhotos(executor: typeof db = db): Promise<QrTitlePhoto[]> {
  const rows = await executor.select({ settingKey: systemSettings.settingKey, settingValue: systemSettings.settingValue })
    .from(systemSettings)
    .where(sql`LEFT(${systemSettings.settingKey}, ${QR_TITLE_SETTING_PREFIX.length}) = ${QR_TITLE_SETTING_PREFIX}`)
    .orderBy(asc(systemSettings.settingKey));
  return orderedQrTitlePhotos(rows.flatMap(row => {
    const photo = parseQrTitlePhoto(row.settingKey, row.settingValue);
    return photo && !photo.screenId ? [photo] : [];
  }));
}

export async function listAllQrTitlePhotos(executor: typeof db = db): Promise<QrTitlePhoto[]> {
  const rows = await executor.select({ settingKey: systemSettings.settingKey, settingValue: systemSettings.settingValue })
    .from(systemSettings)
    .where(sql`LEFT(${systemSettings.settingKey}, ${QR_TITLE_SETTING_PREFIX.length}) = ${QR_TITLE_SETTING_PREFIX}`)
    .orderBy(asc(systemSettings.settingKey));
  return orderedQrTitlePhotos(rows.flatMap(row => {
    const photo = parseQrTitlePhoto(row.settingKey, row.settingValue);
    return photo ? [photo] : [];
  }));
}

export async function qrTitleScreenPhotosAreConfigured(screenId: QrTitleScreenId, executor: typeof db = db): Promise<boolean> {
  const [row] = await executor.select({ settingValue: systemSettings.settingValue }).from(systemSettings)
    .where(eq(systemSettings.settingKey, qrTitleScreenPhotosConfiguredKey(screenId))).limit(1);
  return row?.settingValue === "1";
}

export async function listQrTitleScreenPhotos(screenId: QrTitleScreenId, executor: typeof db = db): Promise<QrTitlePhoto[]> {
  if (!await qrTitleScreenPhotosAreConfigured(screenId, executor)) return screenId === "order" ? listQrTitlePhotos(executor) : [];
  const prefix = `${QR_TITLE_SETTING_PREFIX}${screenId}_`;
  const rows = await executor.select({ settingKey: systemSettings.settingKey, settingValue: systemSettings.settingValue })
    .from(systemSettings)
    .where(sql`LEFT(${systemSettings.settingKey}, ${prefix.length}) = ${prefix}`)
    .orderBy(asc(systemSettings.settingKey));
  return orderedQrTitlePhotos(rows.flatMap(row => {
    const photo = parseQrTitlePhoto(row.settingKey, row.settingValue);
    return photo?.screenId === screenId ? [photo] : [];
  }));
}

export async function getQrTitleScreenSettings(screenId: QrTitleScreenId, legacyStoreName = "", executor: typeof db = db): Promise<QrTitleScreenSettings> {
  const fields: QrTitleScreenSettingField[] = ["title", "leftMode", "leftText", "rightMode", "rightText", "footerMode", "footerText"];
  const defaults = defaultQrTitleScreenSettings(screenId, legacyStoreName);
  const keys = fields.map(field => qrTitleScreenSettingKey(screenId, field));
  const rows = await executor.select({ settingKey: systemSettings.settingKey, settingValue: systemSettings.settingValue }).from(systemSettings)
    .where(inArray(systemSettings.settingKey, keys));
  const saved = new Map(rows.map(row => [row.settingKey, row.settingValue]));
  const title = saved.get(qrTitleScreenSettingKey(screenId, "title"));
  const leftMode = saved.get(qrTitleScreenSettingKey(screenId, "leftMode"));
  const rightMode = saved.get(qrTitleScreenSettingKey(screenId, "rightMode"));
  const footerMode = saved.get(qrTitleScreenSettingKey(screenId, "footerMode"));
  return {
    ...defaults,
    ...(title !== undefined ? { title } : {}),
    ...(leftMode === "SHARE_QR" || leftMode === "TEXT" || leftMode === "HIDE" ? { leftMode } : {}),
    ...(saved.has(qrTitleScreenSettingKey(screenId, "leftText")) ? { leftText: saved.get(qrTitleScreenSettingKey(screenId, "leftText"))! } : {}),
    ...(rightMode === "TABLE_NO" || rightMode === "TEXT" || rightMode === "HIDE" ? { rightMode } : {}),
    ...(saved.has(qrTitleScreenSettingKey(screenId, "rightText")) ? { rightText: saved.get(qrTitleScreenSettingKey(screenId, "rightText"))! } : {}),
    ...(footerMode === "BUSINESS_HOURS" || footerMode === "TEXT" || footerMode === "HIDE" ? { footerMode } : {}),
    ...(saved.has(qrTitleScreenSettingKey(screenId, "footerText")) ? { footerText: saved.get(qrTitleScreenSettingKey(screenId, "footerText"))! } : {}),
  };
}

export async function getQrTitlePhoto(photoId: string, executor: typeof db = db): Promise<QrTitlePhoto | null> {
  const [row] = await executor.select({ settingKey: systemSettings.settingKey, settingValue: systemSettings.settingValue })
    .from(systemSettings).where(eq(systemSettings.settingKey, qrTitlePhotoSettingKey(photoId))).limit(1);
  return row ? parseQrTitlePhoto(row.settingKey, row.settingValue) : null;
}

export async function getQrTitleSubtitle(executor: typeof db = db): Promise<string> {
  const [row] = await executor.select({ settingValue: systemSettings.settingValue }).from(systemSettings)
    .where(eq(systemSettings.settingKey, QR_TITLE_SUBTITLE_SETTING_KEY)).limit(1);
  return row?.settingValue ?? "";
}

export async function listActiveQrTitleSlides() {
  return (await listQrTitlePhotos()).filter(photo => photo.isActive).map(photo => ({
    id: photo.photoId,
    imageUrl: `/api/qr/title-images/${photo.assetId}`,
    alt: "매장 소개 사진",
  }));
}

export async function getQrBusinessHoursSettings(now = new Date()) {
  const dayKeys = Array.from({ length: 7 }, (_, day) => businessHoursSettingKey(day));
  const rows = await db.select({ settingKey: systemSettings.settingKey, settingValue: systemSettings.settingValue }).from(systemSettings)
    .where(or(inArray(systemSettings.settingKey, dayKeys), eq(systemSettings.settingKey, QR_BUSINESS_MODE_KEY), eq(systemSettings.settingKey, QR_BUSINESS_TODAY_OVERRIDE_KEY),
      sql`LEFT(${systemSettings.settingKey}, ${QR_BUSINESS_SPECIAL_PREFIX.length}) = ${QR_BUSINESS_SPECIAL_PREFIX}`,
      sql`LEFT(${systemSettings.settingKey}, ${QR_BUSINESS_CLOSURE_PREFIX.length}) = ${QR_BUSINESS_CLOSURE_PREFIX}`,
      sql`LEFT(${systemSettings.settingKey}, ${QR_BUSINESS_HOLIDAY_PREFIX.length}) = ${QR_BUSINESS_HOLIDAY_PREFIX}`));
  const byKey = new Map(rows.map(row => [row.settingKey, row.settingValue]));
  const weekly = Array.from({ length: 7 }, (_, day) => parseBusinessHours(byKey.get(businessHoursSettingKey(day))));
  const specialHours: SpecialBusinessHours[] = rows.flatMap(row => {
    if (!row.settingKey.startsWith(QR_BUSINESS_SPECIAL_PREFIX)) return [];
    const date = row.settingKey.slice(QR_BUSINESS_SPECIAL_PREFIX.length);
    return [{ date, hours: parseBusinessHours(row.settingValue) }];
  }).filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.date)).sort((a, b) => a.date.localeCompare(b.date));
  const closedDates: BusinessDateClosure[] = rows.flatMap(row => {
    if (!row.settingKey.startsWith(QR_BUSINESS_CLOSURE_PREFIX)) return [];
    const value = parseBusinessDateClosure(row.settingKey.slice(QR_BUSINESS_CLOSURE_PREFIX.length), row.settingValue);
    return value ? [value] : [];
  }).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const holidayRules: BusinessHolidayRule[] = rows.flatMap(row => {
    if (!row.settingKey.startsWith(QR_BUSINESS_HOLIDAY_PREFIX)) return [];
    const value = parseBusinessHolidayRule(row.settingKey.slice(QR_BUSINESS_HOLIDAY_PREFIX.length), row.settingValue);
    return value ? [value] : [];
  }).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const businessHoursMode: BusinessHoursMode = parseBusinessHoursMode(byKey.get(QR_BUSINESS_MODE_KEY));
  const savedOverride = parseTodayBusinessOverride(byKey.get(QR_BUSINESS_TODAY_OVERRIDE_KEY));
  const operatingDate = getBusinessOperatingDate(weekly, specialHours, now, closedDates, holidayRules);
  const todayOverride = savedOverride?.businessDate === operatingDate ? savedOverride : null;
  const kasiHolidays = await listKasiHolidays();
  return { weekly, specialHours, businessHoursMode, closedDates, holidayRules, kasiHolidays, todayOverride };
}

export async function getQrPublicTitleData(now = new Date()) {
  const [photos, storeInfo, schedule, subtitle] = await Promise.all([listActiveQrTitleSlides(), getStoreInfo(), getQrBusinessHoursSettings(now), getQrTitleSubtitle()]);
  const effectiveHolidayRules = [...schedule.holidayRules];
  for (const holiday of schedule.kasiHolidays) {
    if (effectiveHolidayRules.some(item => holiday.date >= item.startDate && holiday.date <= item.endDate)) continue;
    effectiveHolidayRules.push({ id: `kasi-${holiday.date}`, startDate: holiday.date, endDate: holiday.date, mode: "REGULAR", hours: { ...EMPTY_BUSINESS_HOURS } });
  }
  return { photos, storeName: storeInfo.storeName, subtitle, ...schedule, holidayRules: effectiveHolidayRules.sort((a, b) => a.startDate.localeCompare(b.startDate)), serverNow: now.toISOString() };
}

export async function getQrScreenTitleData(screenId: QrTitleScreenId, now = new Date()) {
  const base = await getQrPublicTitleData(now);
  const [screenSettings, photos] = await Promise.all([
    getQrTitleScreenSettings(screenId, base.storeName),
    listQrTitleScreenPhotos(screenId),
  ]);
  return {
    ...base,
    screenSettings,
    photos: photos.filter(photo => photo.isActive).map(photo => ({
      id: photo.photoId,
      imageUrl: `/api/qr/title-images/${photo.assetId}?screen=${screenId}`,
      alt: screenId === "order" ? "주문하기 타이틀 사진" : "주문내역 타이틀 사진",
    })),
  };
}
