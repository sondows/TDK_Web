import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessSessionMutex, businessSessions, systemSettings, tableSessions } from "@/db/schema";
import { isValidCutoffTime, resolveBusinessDate } from "@/lib/business-date";

export type BusinessTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const BUSINESS_CUTOFF_KEY = "business_day_cutoff_time";
export const OPENING_CASH_ENABLED_KEY = "business_opening_cash_enabled";

export class BusinessOpeningRequiredError extends Error {
  constructor() { super("영업 준비금을 입력한 후 영업을 시작해 주세요."); }
}
export class BusinessSessionConflictError extends Error {}

export async function businessSettings(tx: BusinessTx) {
  const rows = await tx.select({ key: systemSettings.settingKey, value: systemSettings.settingValue })
    .from(systemSettings).where(sql`${systemSettings.settingKey} IN (${BUSINESS_CUTOFF_KEY}, ${OPENING_CASH_ENABLED_KEY})`);
  const settings = new Map(rows.map(row => [row.key, row.value]));
  const cutoffTime = settings.get(BUSINESS_CUTOFF_KEY) ?? "06:00";
  if (!isValidCutoffTime(cutoffTime)) throw new Error("Invalid business-day cutoff setting");
  return { cutoffTime, openingCashEnabled: settings.get(OPENING_CASH_ENABLED_KEY) === "1" };
}

/** Lock order: global mutex, then business session, then table session. */
export async function lockBusinessMutex(tx: BusinessTx) {
  const [row] = await tx.select({ id: businessSessionMutex.mutexId }).from(businessSessionMutex)
    .where(eq(businessSessionMutex.mutexId, 1)).for("update").limit(1);
  if (!row) throw new Error("Business session migration is incomplete");
}

export async function ensureBusinessSession(tx: BusinessTx, openingCash?: number) {
  await lockBusinessMutex(tx);
  const [open] = await tx.select().from(businessSessions).where(eq(businessSessions.openGuard, 1)).limit(1);
  if (open) return open;
  const [unassigned] = await tx.select({ id: tableSessions.sessionId }).from(tableSessions)
    .where(sql`${tableSessions.status} = 'OPEN' AND ${tableSessions.businessSessionId} IS NULL`).limit(1);
  if (unassigned) throw new BusinessSessionConflictError("기존 진행 중인 테이블/포장 주문이 있습니다. 먼저 기존 주문을 완료해 주세요.");
  const settings = await businessSettings(tx);
  if (settings.openingCashEnabled && (!Number.isSafeInteger(openingCash) || openingCash! < 0)) throw new BusinessOpeningRequiredError();
  const [clock] = await tx.select({ local: sql<string>`DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s')` }).from(businessSessionMutex).limit(1);
  const [inserted] = await tx.insert(businessSessions).values({
    businessDate: resolveBusinessDate(clock.local, settings.cutoffTime),
    status: "OPEN", openGuard: 1, cutoffTime: settings.cutoffTime,
    openingCashEnabled: settings.openingCashEnabled ? 1 : 0,
    openingCash: settings.openingCashEnabled ? openingCash!.toFixed(2) : null,
  });
  const [created] = await tx.select().from(businessSessions).where(eq(businessSessions.businessSessionId, Number(inserted.insertId))).limit(1);
  return created;
}
