import "server-only";

import { eq, inArray, sql } from "drizzle-orm";
import type { RowDataPacket } from "mysql2/promise";
import { db, pool } from "@/db";
import { systemSettings } from "@/db/schema";
import { decryptKasiServiceKey, encryptKasiServiceKey } from "@/lib/kasi-holiday-crypto";
import { KasiHolidayApiError, fetchKasiHolidayPage, parseKasiHolidayItems } from "@/lib/kasi-holiday-api";
import {
  KASI_HOLIDAY_API_ACTIVE_KEY, KASI_HOLIDAY_API_NAME_KEY, KASI_HOLIDAY_API_PROVIDER_KEY, KASI_HOLIDAY_API_PURPOSE_KEY,
  KASI_HOLIDAY_DATE_PREFIX, KASI_HOLIDAY_SECRET_KEY, KASI_HOLIDAY_SYNC_INTERVAL_MS,
  KASI_HOLIDAY_SYNC_STATE_KEY, kasiHolidayDateKey, parseKasiHolidayDateKey, parseKasiHolidayName, parseKasiHolidaySyncState,
  type KasiHoliday, type KasiHolidaySyncState,
} from "@/lib/kasi-holiday-model";

export class KasiHolidayVaultError extends Error {
  constructor(message: string, readonly code: "MASTER_KEY_MISSING" | "MASTER_KEY_INVALID" | "CIPHERTEXT_INVALID" | "KEY_TOO_LARGE" = "CIPHERTEXT_INVALID") {
    super(message);
    this.name = "KasiHolidayVaultError";
  }
}

function masterKeyEnvName() {
  return process.env.NODE_ENV === "production" ? "KASI_HOLIDAY_ENCRYPTION_KEY_PROD" : "KASI_HOLIDAY_ENCRYPTION_KEY_DEV";
}

function readMasterKey() {
  const envName = masterKeyEnvName();
  const value = process.env[envName];
  if (!value) throw new KasiHolidayVaultError("서버 암호화 마스터 키가 설정되지 않았습니다.", "MASTER_KEY_MISSING");
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new KasiHolidayVaultError("서버 암호화 마스터 키 형식이 올바르지 않습니다.", "MASTER_KEY_INVALID");
  return Buffer.from(value, "hex");
}

export function isKasiHolidayMasterKeyConfigured() {
  try { readMasterKey(); return true; } catch { return false; }
}

export async function readKasiHolidayServiceKey() {
  const [activeRow] = await db.select({ settingValue: systemSettings.settingValue }).from(systemSettings)
    .where(eq(systemSettings.settingKey, KASI_HOLIDAY_API_ACTIVE_KEY)).limit(1);
  if (activeRow?.settingValue === "0") return null;
  const [row] = await db.select({ settingValue: systemSettings.settingValue }).from(systemSettings)
    .where(eq(systemSettings.settingKey, KASI_HOLIDAY_SECRET_KEY)).limit(1);
  if (!row) return null;
  try { return decryptKasiServiceKey(row.settingValue, readMasterKey()); }
  catch { throw new KasiHolidayVaultError("저장된 인증키를 복호화하지 못했습니다. 서버 암호화 키 설정을 확인해 주세요.", "CIPHERTEXT_INVALID"); }
}

export async function saveKasiHolidayServiceKey(value: string, staffId: number) {
  const key = value.trim();
  if (key.length < 8 || key.length > 512 || /[\u0000-\u001f\u007f\s]/.test(key)) throw new KasiHolidayVaultError("인증키 입력값을 확인해 주세요.", "CIPHERTEXT_INVALID");
  let encrypted: string;
  try { encrypted = encryptKasiServiceKey(key, readMasterKey()); }
  catch (error) {
    if (error instanceof Error && error.message === "ENCRYPTED_VALUE_TOO_LARGE") throw new KasiHolidayVaultError("암호화된 인증키가 기존 설정 저장 한도를 초과합니다. 발급받은 인증키 형식을 확인해 주세요.", "KEY_TOO_LARGE");
    if (error instanceof KasiHolidayVaultError) throw error;
    throw new KasiHolidayVaultError("인증키를 암호화하지 못했습니다.", "CIPHERTEXT_INVALID");
  }
  await db.insert(systemSettings).values({ settingKey: KASI_HOLIDAY_SECRET_KEY, settingValue: encrypted, updatedByStaffId: staffId })
    .onDuplicateKeyUpdate({ set: { settingValue: encrypted, updatedByStaffId: staffId, updatedAt: new Date() } });
}

export async function deleteKasiHolidayServiceKey() {
  await db.delete(systemSettings).where(inArray(systemSettings.settingKey, [KASI_HOLIDAY_SECRET_KEY, KASI_HOLIDAY_API_NAME_KEY, KASI_HOLIDAY_API_PROVIDER_KEY, KASI_HOLIDAY_API_PURPOSE_KEY, KASI_HOLIDAY_API_ACTIVE_KEY]));
  const state = await readKasiHolidaySyncState();
  await writeKasiHolidaySyncState({ ...state, connectionStatus: "UNKNOWN", lastCheckedAt: null, lastError: "" });
}

export async function saveKasiHolidayApiMetadata(input: { name: string; provider: string; purpose: string; active: boolean }, staffId: number) {
  const fields = [
    [KASI_HOLIDAY_API_NAME_KEY, input.name, 80],
    [KASI_HOLIDAY_API_PROVIDER_KEY, input.provider, 60],
    [KASI_HOLIDAY_API_PURPOSE_KEY, input.purpose, 100],
    [KASI_HOLIDAY_API_ACTIVE_KEY, input.active ? "1" : "0", 1],
  ] as const;
  if (fields.some(([, value, max]) => !value.trim() || [...value.trim()].length > max || /[\u0000-\u001f\u007f]/.test(value))) {
    throw new KasiHolidayVaultError("API 이름, 제공기관, 사용 목적을 확인해 주세요.", "CIPHERTEXT_INVALID");
  }
  for (const [settingKey, value] of fields) {
    const settingValue = value.trim();
    await db.insert(systemSettings).values({ settingKey, settingValue, updatedByStaffId: staffId })
      .onDuplicateKeyUpdate({ set: { settingValue, updatedByStaffId: staffId, updatedAt: new Date() } });
  }
}

export async function readKasiHolidaySyncState(): Promise<KasiHolidaySyncState> {
  const [row] = await db.select({ settingValue: systemSettings.settingValue }).from(systemSettings)
    .where(eq(systemSettings.settingKey, KASI_HOLIDAY_SYNC_STATE_KEY)).limit(1);
  return parseKasiHolidaySyncState(row?.settingValue);
}

async function writeKasiHolidaySyncState(state: KasiHolidaySyncState) {
  const compact = JSON.stringify({ c: state.connectionStatus, check: state.lastCheckedAt, sync: state.lastSyncAt, s: state.lastSyncStatus, n: state.lastSyncCount, y: state.lastSyncYears, e: state.lastError.slice(0, 100) });
  if (compact.length > 255) throw new Error("KASI sync status exceeded the existing settings column limit.");
  await db.insert(systemSettings).values({ settingKey: KASI_HOLIDAY_SYNC_STATE_KEY, settingValue: compact, updatedByStaffId: null })
    .onDuplicateKeyUpdate({ set: { settingValue: compact, updatedByStaffId: null, updatedAt: new Date() } });
}

export async function listKasiHolidays(): Promise<KasiHoliday[]> {
  const rows = await db.select({ settingKey: systemSettings.settingKey, settingValue: systemSettings.settingValue }).from(systemSettings)
    .where(sql`LEFT(${systemSettings.settingKey}, ${KASI_HOLIDAY_DATE_PREFIX.length}) = ${KASI_HOLIDAY_DATE_PREFIX}`)
    .orderBy(systemSettings.settingKey);
  return rows.flatMap(row => {
    const date = parseKasiHolidayDateKey(row.settingKey);
    const name = parseKasiHolidayName(row.settingValue);
    return date && name ? [{ date, name }] : [];
  });
}

export async function getKasiHolidayAdminState() {
  const [[secret], metadataRows, syncState, holidays] = await Promise.all([
    db.select({ settingKey: systemSettings.settingKey, updatedAt: systemSettings.updatedAt }).from(systemSettings).where(eq(systemSettings.settingKey, KASI_HOLIDAY_SECRET_KEY)).limit(1),
    db.select({ settingKey: systemSettings.settingKey, settingValue: systemSettings.settingValue, updatedAt: systemSettings.updatedAt }).from(systemSettings)
      .where(inArray(systemSettings.settingKey, [KASI_HOLIDAY_API_NAME_KEY, KASI_HOLIDAY_API_PROVIDER_KEY, KASI_HOLIDAY_API_PURPOSE_KEY, KASI_HOLIDAY_API_ACTIVE_KEY])),
    readKasiHolidaySyncState(), listKasiHolidays(),
  ]);
  const metadata = new Map(metadataRows.map(row => [row.settingKey, row.settingValue]));
  const updatedAt = [secret?.updatedAt, ...metadataRows.map(row => row.updatedAt)].filter((date): date is Date => date instanceof Date).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    configured: Boolean(secret), masterKeyConfigured: isKasiHolidayMasterKeyConfigured(),
    updatedAt: updatedAt?.toISOString() ?? null,
    api: {
      id: "kasi_holiday" as const,
      name: metadata.get(KASI_HOLIDAY_API_NAME_KEY) ?? "한국천문연구원 공휴일 API",
      provider: metadata.get(KASI_HOLIDAY_API_PROVIDER_KEY) ?? "한국천문연구원",
      purpose: metadata.get(KASI_HOLIDAY_API_PURPOSE_KEY) ?? "QR 법정공휴일 자동 조회",
      type: "API_KEY" as const,
      active: metadata.get(KASI_HOLIDAY_API_ACTIVE_KEY) !== "0",
    },
    ...syncState, holidays,
  };
}

type ApiYearResult = { supported: boolean; holidays: KasiHoliday[] };
async function fetchKasiHolidayYear(serviceKey: string, year: number): Promise<ApiYearResult> {
  const items: Array<{ locdate: string | number; dateName: string; isHoliday: string }> = [];
  let supportedMonths = 0;
  const rowsPerPage = 1000;
  for (let month = 1; month <= 12; month++) {
    if (month > 1) await new Promise(resolve => setTimeout(resolve, 100));
    const first = await fetchKasiHolidayPage(serviceKey, year, month, 1);
    if (first.resultCode === "03") continue;
    supportedMonths++;
    const monthItems = [...first.items];
    const pages = Math.min(20, Math.ceil(first.totalCount / rowsPerPage));
    for (let pageNo = 2; pageNo <= pages; pageNo++) {
      const page = await fetchKasiHolidayPage(serviceKey, year, month, pageNo);
      if (page.resultCode === "03") throw new KasiHolidayApiError("공휴일 API 페이지 응답이 일치하지 않습니다.", "FORMAT");
      monthItems.push(...page.items);
    }
    if (monthItems.length < first.totalCount) throw new KasiHolidayApiError("공휴일 API에서 전체 월 데이터를 확인하지 못했습니다.", "FORMAT");
    items.push(...monthItems);
  }
  return { supported: supportedMonths > 0, holidays: parseKasiHolidayItems({ resultCode: "00", resultMsg: "", totalCount: items.length, items }, year) };
}

async function writeYearCache(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], year: number, holidays: KasiHoliday[]) {
  const rows = await tx.select({ settingKey: systemSettings.settingKey }).from(systemSettings)
    .where(sql`LEFT(${systemSettings.settingKey}, ${KASI_HOLIDAY_DATE_PREFIX.length}) = ${KASI_HOLIDAY_DATE_PREFIX}`).for("update");
  const nextByKey = new Map(holidays.map(item => [kasiHolidayDateKey(item.date), item]));
  const stale = rows.map(row => row.settingKey).filter(key => {
    const date = parseKasiHolidayDateKey(key);
    return date?.startsWith(`${year}-`) && !nextByKey.has(key);
  });
  if (stale.length) await tx.delete(systemSettings).where(inArray(systemSettings.settingKey, stale));
  for (const [settingKey, holiday] of nextByKey) {
    const settingValue = JSON.stringify({ v: 1, name: holiday.name });
    await tx.insert(systemSettings).values({ settingKey, settingValue, updatedByStaffId: null })
      .onDuplicateKeyUpdate({ set: { settingValue, updatedByStaffId: null, updatedAt: new Date() } });
  }
}

function safeErrorMessage(error: unknown) {
  if (error instanceof KasiHolidayApiError || error instanceof KasiHolidayVaultError) return error.message.slice(0, 100);
  if (error instanceof Error && error.name === "TimeoutError") return "한국천문연구원 API 응답 시간이 초과되었습니다.";
  return "공휴일 API 연동 중 오류가 발생했습니다. 설정과 네트워크를 확인해 주세요.";
}

async function runWithDatabaseLock<T>(callback: () => Promise<T>): Promise<T | null> {
  const connection = await pool.getConnection();
  let acquired = false;
  try {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK('tdkon_kasi_holiday_sync', 0) AS acquired");
    acquired = Number(rows[0]?.acquired) === 1;
    if (!acquired) return null;
    return await callback();
  } finally {
    if (acquired) await connection.query("SELECT RELEASE_LOCK('tdkon_kasi_holiday_sync')").catch(() => undefined);
    connection.release();
  }
}

export async function testKasiHolidayConnection() {
  const now = new Date();
  const previous = await readKasiHolidaySyncState();
  try {
    const serviceKey = await readKasiHolidayServiceKey();
    if (!serviceKey) throw new KasiHolidayVaultError("등록된 인증키가 없습니다.", "CIPHERTEXT_INVALID");
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).formatToParts(now);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    await fetchKasiHolidayPage(serviceKey, Number(values.year), Number(values.month));
    const next = { ...previous, connectionStatus: "OK" as const, lastCheckedAt: now.toISOString(), lastError: "" };
    await writeKasiHolidaySyncState(next);
    return { success: true, state: next };
  } catch (error) {
    const next = { ...previous, connectionStatus: "ERROR" as const, lastCheckedAt: now.toISOString(), lastError: safeErrorMessage(error) };
    await writeKasiHolidaySyncState(next);
    return { success: false, state: next, message: next.lastError };
  }
}

export async function syncKasiHolidayCalendar(options: { force?: boolean } = {}) {
  const forced = options.force === true;
  return runWithDatabaseLock(async () => {
    const previous = await readKasiHolidaySyncState();
    if (!forced && previous.lastSyncAt && Date.now() - Date.parse(previous.lastSyncAt) < KASI_HOLIDAY_SYNC_INTERVAL_MS) {
      return { success: true, skipped: true, state: previous, count: previous.lastSyncCount };
    }
    const now = new Date();
    try {
      const serviceKey = await readKasiHolidayServiceKey();
      if (!serviceKey) return { success: true, skipped: true, state: previous, count: 0 };
      const yearParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric" }).formatToParts(now);
      const currentYear = Number(Object.fromEntries(yearParts.map(part => [part.type, part.value])).year);
      const fetched: ApiYearResult[] = [];
      fetched.push(await fetchKasiHolidayYear(serviceKey, currentYear));
      fetched.push(await fetchKasiHolidayYear(serviceKey, currentYear + 1));
      const successfulYears = [currentYear, currentYear + 1].filter((_, index) => fetched[index].supported);
      if (successfulYears.length) {
        await db.transaction(async tx => {
          for (let index = 0; index < fetched.length; index++) {
            if (fetched[index].supported) await writeYearCache(tx, currentYear + index, fetched[index].holidays);
          }
        });
      }
      const partial = successfulYears.length !== 2;
      const count = fetched.reduce((total, year) => total + year.holidays.length, 0);
      const next: KasiHolidaySyncState = {
        ...previous, connectionStatus: "OK", lastCheckedAt: now.toISOString(), lastSyncAt: now.toISOString(),
        lastSyncStatus: partial ? "PARTIAL" : "SUCCESS", lastSyncCount: count, lastSyncYears: successfulYears,
        lastError: partial ? "API에서 제공되지 않은 연도는 생성하거나 기존 캐시를 삭제하지 않았습니다." : "",
      };
      await writeKasiHolidaySyncState(next);
      return { success: true, skipped: false, state: next, count };
    } catch (error) {
      const message = safeErrorMessage(error);
      const next: KasiHolidaySyncState = {
        ...previous, connectionStatus: "ERROR", lastCheckedAt: now.toISOString(), lastSyncStatus: "ERROR", lastError: message,
      };
      await writeKasiHolidaySyncState(next);
      return { success: false, skipped: false, state: next, count: 0, message };
    }
  });
}

export async function updateKasiHolidayConnectionStatus(status: "OK" | "ERROR", message = "") {
  const previous = await readKasiHolidaySyncState();
  const next = { ...previous, connectionStatus: status, lastCheckedAt: new Date().toISOString(), lastError: message.slice(0, 100) };
  await writeKasiHolidaySyncState(next);
  return next;
}

export function scheduleKasiHolidayAutoSync() {
  const registry = globalThis as typeof globalThis & { __tdkonKasiHolidaySyncStarted?: boolean };
  if (registry.__tdkonKasiHolidaySyncStarted) return;
  registry.__tdkonKasiHolidaySyncStarted = true;
  const run = () => {
    void syncKasiHolidayCalendar().catch(() => undefined);
  };
  const startupTimer = setTimeout(run, 60_000);
  startupTimer.unref?.();
  const weeklyTimer = setInterval(run, KASI_HOLIDAY_SYNC_INTERVAL_MS);
  weeklyTimer.unref?.();
}
