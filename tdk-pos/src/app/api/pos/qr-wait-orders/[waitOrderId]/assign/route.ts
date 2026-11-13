import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { diningTables, qrWaitOrders, tableSessionMerges, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { DailyOpeningRequiredError, ensureDailyOpeningCash } from "@/lib/daily-opening-cash";
import { canAssignQrWaitOrder } from "@/lib/qr-wait-order-policy";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ waitOrderId: string }> };

export async function POST(request: Request, { params }: Context) {
  const staff = await getCurrentStaff();
  if (!staff) return Response.json({ success: false }, { status: 401 });
  const waitOrderId = Number((await params).waitOrderId);
  const body = await request.json().catch(() => null) as { tableId?: unknown; version?: unknown } | null;
  const tableId = Number(body?.tableId);
  if (!body || !Number.isSafeInteger(waitOrderId) || waitOrderId <= 0 || !Number.isSafeInteger(tableId) || tableId <= 0 || !Number.isSafeInteger(body.version))
    return Response.json({ success: false, message: "테이블 배정 요청을 확인해 주세요." }, { status: 400 });
  try {
    const assignedSessionId = await db.transaction(async tx => {
      await ensureDailyOpeningCash(tx);
      const [table] = await tx.select({ tableId: diningTables.tableId }).from(diningTables)
        .where(and(eq(diningTables.tableId, tableId), eq(diningTables.isActive, 1))).for("update").limit(1);
      if (!table) throw new AssignmentError("TABLE_UNAVAILABLE");
      const [open] = await tx.select({ sessionId: tableSessions.sessionId }).from(tableSessions)
        .where(and(eq(tableSessions.tableId, tableId), eq(tableSessions.status, "OPEN"))).for("update").limit(1);
      if (open) throw new AssignmentError("TABLE_OCCUPIED");
      const [activeMerge] = await tx.select({ id: tableSessionMerges.mergeId }).from(tableSessionMerges)
        .where(and(eq(tableSessionMerges.sourceTableId, tableId), eq(tableSessionMerges.status, "ACTIVE"))).limit(1);
      if (activeMerge) throw new AssignmentError("TABLE_MERGED");
      const [order] = await tx.select({ status: qrWaitOrders.status, version: qrWaitOrders.version })
        .from(qrWaitOrders).where(eq(qrWaitOrders.waitOrderId, waitOrderId)).for("update").limit(1);
      if (!order || !canAssignQrWaitOrder(order.status) || order.version !== body.version) throw new AssignmentError("ORDER_CHANGED");
      const [sessionInsert] = await tx.insert(tableSessions).values({ tableId, personCount: 0, babyCount: 0,
        status: "OPEN", sessionKind: "DINE_IN", openedByStaffId: staff.staffId });
      const sessionId = Number(sessionInsert.insertId);
      const update = await tx.update(qrWaitOrders).set({ status: "ASSIGNED", assignedSessionId: sessionId,
        assignedByStaffId: staff.staffId, version: order.version + 1, updatedAt: new Date() })
        .where(and(eq(qrWaitOrders.waitOrderId, waitOrderId), eq(qrWaitOrders.status, "PENDING"), eq(qrWaitOrders.version, order.version)));
      if (Number(update[0].affectedRows) !== 1) throw new AssignmentError("ORDER_CHANGED");
      return sessionId;
    });
    return Response.json({ success: true, assignedSessionId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DailyOpeningRequiredError) return Response.json({ success: false, openingRequired: true, message: error.message }, { status: 428 });
    if (error instanceof AssignmentError) {
      const messages: Record<string, string> = { TABLE_UNAVAILABLE: "선택한 테이블을 사용할 수 없습니다.", TABLE_OCCUPIED: "이미 사용 중인 테이블입니다.", TABLE_MERGED: "다른 테이블에 합쳐진 테이블입니다.", ORDER_CHANGED: "대기 주문 상태가 바뀌었습니다. 새로고침해 주세요." };
      return Response.json({ success: false, message: messages[error.message] ?? "테이블을 배정하지 못했습니다." }, { status: 409 });
    }
    console.error("POS QR wait table assignment failed", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "테이블 배정에 실패했습니다." }, { status: 503 });
  }
}

class AssignmentError extends Error {}
