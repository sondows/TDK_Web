import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessSessions, dailyClosingSnapshots } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";

export async function GET(request: Request) {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to))
    return Response.json({ success: false, message: "조회기간을 확인해 주세요." }, { status: 400 });
  const rows = await db.select({
    businessSessionId: businessSessions.businessSessionId, businessDate: businessSessions.businessDate,
    closingSnapshot: businessSessions.closingSnapshot,
    closedAtLocal: sql<string | null>`DATE_FORMAT(${businessSessions.closedAt}, '%Y-%m-%dT%H:%i:%s')`,
  }).from(businessSessions).where(and(eq(businessSessions.status, "CLOSED"),
    from ? gte(businessSessions.businessDate, from) : undefined,
    to ? lte(businessSessions.businessDate, to) : undefined))
    .orderBy(desc(businessSessions.businessDate), asc(businessSessions.businessSessionId));
  const days = new Map<string, { businessDate: string; totalSales: number; saleCount: number; sessions: Array<Record<string, unknown>> }>();
  for (const row of rows) {
    if (!row.closingSnapshot) continue;
    const snapshot = JSON.parse(row.closingSnapshot) as { totalSales: number; saleCount: number };
    const day = days.get(row.businessDate) ?? { businessDate: row.businessDate, totalSales: 0, saleCount: 0, sessions: [] };
    day.totalSales += snapshot.totalSales;
    day.saleCount += snapshot.saleCount;
    day.sessions.push({ ...snapshot, closedAt: row.closedAtLocal ? `${row.closedAtLocal}+09:00` : null, sessionId: row.businessSessionId });
    days.set(row.businessDate, day);
  }
  const revisions = await db.select({
    id: dailyClosingSnapshots.dailyClosingId, date: dailyClosingSnapshots.salesDate,
    revision: dailyClosingSnapshots.revision, snapshot: dailyClosingSnapshots.snapshot,
    closedAtLocal: sql<string>`DATE_FORMAT(${dailyClosingSnapshots.closedAt}, '%Y-%m-%dT%H:%i:%s')`,
  }).from(dailyClosingSnapshots).where(and(
    from ? gte(dailyClosingSnapshots.salesDate, from) : undefined,
    to ? lte(dailyClosingSnapshots.salesDate, to) : undefined,
  )).orderBy(desc(dailyClosingSnapshots.salesDate), asc(dailyClosingSnapshots.revision));
  for (const row of revisions) {
    const snapshot = JSON.parse(row.snapshot) as { totalSales: number; saleCount: number };
    const day = days.get(row.date) ?? { businessDate: row.date, totalSales: 0, saleCount: 0, sessions: [] };
    if (row.revision === 1) day.sessions = []; // Old session records are retained in DB, not mixed into new cumulative revisions.
    day.totalSales = snapshot.totalSales;
    day.saleCount = snapshot.saleCount;
    day.sessions.push({ ...snapshot, closedAt: `${row.closedAtLocal}+09:00`, sessionId: row.id, revision: row.revision });
    days.set(row.date, day);
  }
  return Response.json({ success: true, days: [...days.values()].sort((a, b) => b.businessDate.localeCompare(a.businessDate)) }, { headers: { "Cache-Control": "no-store" } });
}
