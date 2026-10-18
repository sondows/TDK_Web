import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessSessions } from "@/db/schema";
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
  return Response.json({ success: true, days: [...days.values()] }, { headers: { "Cache-Control": "no-store" } });
}
