export const KASI_HOLIDAY_API_URL = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";
export const KASI_HOLIDAY_SECRET_KEY = "qr_kasi_holiday_api_secret_v1";
export const KASI_HOLIDAY_API_NAME_KEY = "api_kasi_holiday_name";
export const KASI_HOLIDAY_API_PROVIDER_KEY = "api_kasi_holiday_provider";
export const KASI_HOLIDAY_API_PURPOSE_KEY = "api_kasi_holiday_purpose";
export const KASI_HOLIDAY_API_ACTIVE_KEY = "api_kasi_holiday_active";
export const KASI_HOLIDAY_SYNC_STATE_KEY = "qr_kasi_holiday_sync_state";
export const KASI_HOLIDAY_DATE_PREFIX = "qr_kasi_holiday_date_";
export const KASI_HOLIDAY_PROVIDER = "한국천문연구원";
export const KASI_HOLIDAY_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export type KasiHoliday = { date: string; name: string };
export type KasiHolidayApiItem = { locdate: string | number; dateName: string; isHoliday: string };
export type KasiHolidayApiResult = { resultCode: string; resultMsg: string; totalCount: number; items: KasiHolidayApiItem[] };
export type KasiHolidaySyncState = {
  connectionStatus: "UNKNOWN" | "OK" | "ERROR";
  lastCheckedAt: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: "NEVER" | "SUCCESS" | "PARTIAL" | "ERROR";
  lastSyncCount: number;
  lastSyncYears: number[];
  lastError: string;
};

export const EMPTY_KASI_HOLIDAY_SYNC_STATE: KasiHolidaySyncState = {
  connectionStatus: "UNKNOWN", lastCheckedAt: null, lastSyncAt: null,
  lastSyncStatus: "NEVER", lastSyncCount: 0, lastSyncYears: [], lastError: "",
};

export function kasiHolidayDateKey(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`)) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) {
    throw new Error("Invalid holiday date");
  }
  return KASI_HOLIDAY_DATE_PREFIX + date;
}

export function parseKasiHolidayDateKey(settingKey: string): string | null {
  if (!settingKey.startsWith(KASI_HOLIDAY_DATE_PREFIX)) return null;
  const date = settingKey.slice(KASI_HOLIDAY_DATE_PREFIX.length);
  try { kasiHolidayDateKey(date); return date; } catch { return null; }
}

export function parseKasiHolidayName(settingValue: string | null | undefined): string | null {
  if (!settingValue) return null;
  try {
    const parsed = JSON.parse(settingValue) as { name?: unknown; v?: unknown };
    if (parsed.v !== 1 || typeof parsed.name !== "string") return null;
    const name = parsed.name.trim();
    return name && [...name].length <= 120 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
  } catch { return null; }
}

export function parseKasiHolidaySyncState(settingValue: string | null | undefined): KasiHolidaySyncState {
  if (!settingValue) return { ...EMPTY_KASI_HOLIDAY_SYNC_STATE };
  try {
    const value = JSON.parse(settingValue) as Partial<KasiHolidaySyncState> & { c?: unknown; check?: unknown; sync?: unknown; s?: unknown; n?: unknown; y?: unknown; e?: unknown };
    const connectionStatus = value.connectionStatus ?? value.c;
    const lastCheckedAt = value.lastCheckedAt ?? value.check;
    const lastSyncAt = value.lastSyncAt ?? value.sync;
    const lastSyncStatus = value.lastSyncStatus ?? value.s;
    const lastSyncCount = value.lastSyncCount ?? value.n;
    const lastSyncYears = value.lastSyncYears ?? value.y;
    const lastError = value.lastError ?? value.e;
    const validDate = (date: unknown): date is string => typeof date === "string" && Number.isFinite(Date.parse(date));
    return {
      connectionStatus: connectionStatus === "OK" || connectionStatus === "ERROR" ? connectionStatus : "UNKNOWN",
      lastCheckedAt: validDate(lastCheckedAt) ? lastCheckedAt : null,
      lastSyncAt: validDate(lastSyncAt) ? lastSyncAt : null,
      lastSyncStatus: lastSyncStatus === "SUCCESS" || lastSyncStatus === "PARTIAL" || lastSyncStatus === "ERROR" ? lastSyncStatus : "NEVER",
      lastSyncCount: Number.isSafeInteger(lastSyncCount) && Number(lastSyncCount) >= 0 ? Number(lastSyncCount) : 0,
      lastSyncYears: Array.isArray(lastSyncYears) ? lastSyncYears.filter(year => Number.isInteger(year) && year >= 2000 && year <= 2200).slice(0, 2) : [],
      lastError: typeof lastError === "string" ? lastError.slice(0, 100) : "",
    };
  } catch { return { ...EMPTY_KASI_HOLIDAY_SYNC_STATE }; }
}
