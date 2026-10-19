import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessSessionMutex, cashOpeningFunds, systemSettings } from "@/db/schema";
import { OPENING_CASH_ENABLED_KEY, lockBusinessMutex, type BusinessTx } from "@/lib/business-session";

export class DailyOpeningRequiredError extends Error {
  constructor() { super("오늘의 시작 준비금을 입력해 주세요."); }
}

/** The database clock and the sale completion timestamp share the same local date. */
export async function databaseToday(tx: BusinessTx) {
  const [row] = await tx.select({ date: sql<string>`DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d')` }).from(businessSessionMutex).limit(1);
  if (!row) throw new Error("Business mutex migration is incomplete");
  return row.date;
}

/** The database is the source of truth for today's required opening-cash state. */
export async function dailyOpeningCashStatus() {
  return db.transaction(async tx => {
    const [setting] = await tx.select({ value: systemSettings.settingValue }).from(systemSettings)
      .where(eq(systemSettings.settingKey, OPENING_CASH_ENABLED_KEY)).limit(1);
    if (setting?.value !== "1") return { enabled: false, businessDate: await databaseToday(tx), registered: false };
    const businessDate = await databaseToday(tx);
    const [fund] = await tx.select({ id: cashOpeningFunds.cashOpeningFundId }).from(cashOpeningFunds)
      .where(eq(cashOpeningFunds.businessDate, businessDate)).limit(1);
    return { enabled: true, businessDate, registered: Boolean(fund) };
  });
}

/** Called inside the order-creation transaction, before any order/session row is written. */
export async function ensureDailyOpeningCash(tx: BusinessTx) {
  await lockBusinessMutex(tx);
  const [setting] = await tx.select({ value: systemSettings.settingValue }).from(systemSettings)
    .where(eq(systemSettings.settingKey, OPENING_CASH_ENABLED_KEY)).limit(1);
  if (setting?.value !== "1") return;
  const today = await databaseToday(tx);
  const [opening] = await tx.select({ id: cashOpeningFunds.cashOpeningFundId }).from(cashOpeningFunds)
    .where(eq(cashOpeningFunds.businessDate, today)).limit(1);
  if (!opening) throw new DailyOpeningRequiredError();
}
