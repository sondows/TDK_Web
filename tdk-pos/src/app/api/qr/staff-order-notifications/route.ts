import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { diningTables, qrOrders, qrSessions, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getCurrentHosStaff } from "@/lib/hos-auth";
import { loadQrTableIndicators } from "@/lib/qr-table-indicators";

export const dynamic = "force-dynamic";
const EVENT_BATCH_SIZE = 100;

export async function GET(request: Request) {
  const staff = await getCurrentStaff() ?? await getCurrentHosStaff();
  if (!staff) return Response.json({ success: false }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const afterId = Number(new URL(request.url).searchParams.get("afterId"));
  if (!Number.isSafeInteger(afterId) || afterId < 0) {
    return Response.json({ success: false, message: "QR 알림 기준이 올바르지 않습니다." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    // `CURSOR` is reserved in MariaDB/MySQL; keep the generated SQL alias safe.
    const [latest] = await db.select({ latestOrderId: sql<number>`COALESCE(MAX(${qrOrders.qrOrderId}), 0)` }).from(qrOrders);
    const highWatermark = Number(latest?.latestOrderId ?? 0);
    const rows = afterId < highWatermark ? await db.select({ qrOrderId: qrOrders.qrOrderId,
      tableId: sql<number>`COALESCE(${tableSessions.tableId}, ${qrSessions.tableId})`, tableNo: diningTables.tableNo,
      orderedAt: sql<string>`DATE_FORMAT(${qrOrders.orderedAt}, '%Y-%m-%dT%H:%i:%s')` })
      .from(qrOrders).innerJoin(qrSessions, sql`${qrSessions.qrSessionId} = ${qrOrders.qrSessionId}`)
      .leftJoin(tableSessions, sql`${tableSessions.sessionId} = ${qrSessions.sessionId}`)
      .innerJoin(diningTables, sql`${diningTables.tableId} = COALESCE(${tableSessions.tableId}, ${qrSessions.tableId})`)
      .where(sql`${qrOrders.qrOrderId} > ${afterId} AND ${qrOrders.qrOrderId} <= ${highWatermark}`)
      .orderBy(asc(qrOrders.qrOrderId)).limit(EVENT_BATCH_SIZE) : [];
    const events = rows.map(row => ({ qrOrderId: Number(row.qrOrderId), tableId: Number(row.tableId),
      tableNo: String(row.tableNo), orderedAt: row.orderedAt }));
    const cursor = rows.length === EVENT_BATCH_SIZE ? events[events.length - 1].qrOrderId : highWatermark;
    const qrOrderTables = [...(await loadQrTableIndicators()).values()];
    return Response.json({ success: true, cursor, events, qrOrderTables }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("QR order notifications unavailable", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "QR 주문 알림을 불러오지 못했습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
