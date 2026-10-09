import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { auditLogs, cashOpeningFunds, staff } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { cashOpeningFundTotal, parseCashOpeningFund, type CashOpeningFund } from "@/lib/cash-opening-fund";
import { getPosLoginMode } from "@/lib/pos-login-mode";

async function authorizedStaffId() {
  const current = await getCurrentStaff();
  if (current) return current.staffId;
  if (await getPosLoginMode() !== "SHARED") return null;
  const [shared] = await db.select({ staffId: staff.staffId }).from(staff)
    .where(and(eq(staff.staffCode, "000"), eq(staff.isActive, 1))).limit(1);
  return shared?.staffId ?? null;
}

async function businessDates() {
  const [rows] = await pool.query<Array<{ today: string; yesterday: string }> & import("mysql2").RowDataPacket[]>(
    "SELECT DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d') AS today, DATE_FORMAT(CURRENT_DATE() - INTERVAL 1 DAY, '%Y-%m-%d') AS yesterday"
  );
  return rows[0];
}

function fundFromRow(row: typeof cashOpeningFunds.$inferSelect): CashOpeningFund {
  return {
    otherAmount: row.otherAmount,
    counts: { 50_000: row.count50000, 10_000: row.count10000, 5_000: row.count5000, 1_000: row.count1000, 500: row.count500, 100: row.count100 },
  };
}

export async function GET() {
  const staffId = await authorizedStaffId();
  if (!staffId) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  try {
    const dates = await businessDates();
    const [today, yesterday] = await Promise.all([
      db.select().from(cashOpeningFunds).where(eq(cashOpeningFunds.businessDate, dates.today)).limit(1),
      db.select().from(cashOpeningFunds).where(eq(cashOpeningFunds.businessDate, dates.yesterday)).limit(1),
    ]);
    return Response.json({ success: true, businessDate: dates.today, today: today[0] ? fundFromRow(today[0]) : null, yesterday: yesterday[0] ? fundFromRow(yesterday[0]) : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("영업준비금 조회 실패:", error);
    return Response.json({ success: false, message: "영업준비금을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const staffId = await authorizedStaffId();
  if (!staffId) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  try {
    const fund = parseCashOpeningFund(await request.json());
    if (!fund) return Response.json({ success: false, message: "준비금 수량과 금액을 확인해 주세요." }, { status: 400 });
    const totalAmount = cashOpeningFundTotal(fund);
    if (!Number.isSafeInteger(totalAmount)) return Response.json({ success: false, message: "합계금액이 너무 큽니다." }, { status: 400 });
    const dates = await businessDates();
    await db.transaction(async tx => {
      const [previous] = await tx.select().from(cashOpeningFunds).where(eq(cashOpeningFunds.businessDate, dates.today)).limit(1);
      await tx.insert(cashOpeningFunds).values({
        businessDate: dates.today,
        otherAmount: fund.otherAmount,
        count50000: fund.counts[50_000], count10000: fund.counts[10_000], count5000: fund.counts[5_000],
        count1000: fund.counts[1_000], count500: fund.counts[500], count100: fund.counts[100],
        totalAmount, createdByStaffId: staffId, updatedByStaffId: staffId,
      }).onDuplicateKeyUpdate({ set: {
        otherAmount: fund.otherAmount,
        count50000: fund.counts[50_000], count10000: fund.counts[10_000], count5000: fund.counts[5_000],
        count1000: fund.counts[1_000], count500: fund.counts[500], count100: fund.counts[100],
        totalAmount, updatedByStaffId: staffId, updatedAt: sql`CURRENT_TIMESTAMP`,
      } });
      const [saved] = await tx.select({ id: cashOpeningFunds.cashOpeningFundId }).from(cashOpeningFunds).where(eq(cashOpeningFunds.businessDate, dates.today)).limit(1);
      await tx.insert(auditLogs).values({
        staffId, actionType: previous ? "UPDATE" : "CREATE", entityType: "CASH_OPENING_FUND", entityId: saved.id,
        description: JSON.stringify({ businessDate: dates.today, before: previous ? fundFromRow(previous) : null, after: fund, totalAmount }),
      });
    });
    return Response.json({ success: true, businessDate: dates.today, totalAmount });
  } catch (error) {
    console.error("영업준비금 저장 실패:", error);
    return Response.json({ success: false, message: "영업준비금을 저장하지 못했습니다." }, { status: 500 });
  }
}
