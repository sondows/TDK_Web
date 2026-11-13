import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, qrVisitEvents, qrWaitOrders, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ waitOrderId: string }> };

export async function POST(_request: Request, { params }: Context) {
  const staff = await getCurrentStaff();
  if (!staff) return Response.json({ success: false }, { status: 401 });
  const waitOrderId = Number((await params).waitOrderId);
  if (!Number.isSafeInteger(waitOrderId) || waitOrderId <= 0) return Response.json({ success: false }, { status: 404 });
  try {
    const result = await db.transaction(async tx => {
      const [order] = await tx.select({ visitorId: qrWaitOrders.visitorId, status: qrWaitOrders.status,
        version: qrWaitOrders.version, assignedSessionId: qrWaitOrders.assignedSessionId })
        .from(qrWaitOrders).where(eq(qrWaitOrders.waitOrderId, waitOrderId)).for("update").limit(1);
      if (!order) return { kind: "MISSING" as const };
      if (!["PENDING", "ASSIGNED"].includes(order.status)) return { kind: "CONFLICT" as const };
      await tx.update(qrWaitOrders).set({ status: "CANCELLED", cancelledAt: new Date(), updatedAt: new Date(),
        version: order.version + 1, assignedSessionId: null, assignedByStaffId: null })
        .where(and(eq(qrWaitOrders.waitOrderId, waitOrderId), eq(qrWaitOrders.version, order.version)));
      if (order.assignedSessionId) {
        const [existingOrder] = await tx.select({ orderId: orders.orderId }).from(orders)
          .where(eq(orders.sessionId, order.assignedSessionId)).limit(1);
        if (!existingOrder) await tx.update(tableSessions).set({ status: "CLOSED", closedAt: new Date() })
          .where(and(eq(tableSessions.sessionId, order.assignedSessionId), eq(tableSessions.status, "OPEN")));
      }
      return { kind: "CANCELLED" as const, visitorId: order.visitorId };
    });
    if (result.kind === "MISSING") return Response.json({ success: false, message: "대기 주문을 찾을 수 없습니다." }, { status: 404 });
    if (result.kind === "CONFLICT") return Response.json({ success: false, message: "이미 확정되었거나 처리된 주문입니다." }, { status: 409 });
    try { await db.insert(qrVisitEvents).values({ visitorId: result.visitorId, waitOrderId,
      clientEventId: randomUUID(), source: "WAITING", eventType: "WAIT_CANCELLED", menuId: null,
      optionIdsJson: "[]", quantityBefore: 0, quantityDelta: 0, quantityAfter: 0,
      estimatedUnitPrice: null, estimatedLineTotal: null, occurredAt: new Date() }); }
    catch { console.error("QR wait cancellation analytics skipped"); }
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("POS QR wait order cancellation failed", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "대기 주문을 취소하지 못했습니다." }, { status: 503 });
  }
}
