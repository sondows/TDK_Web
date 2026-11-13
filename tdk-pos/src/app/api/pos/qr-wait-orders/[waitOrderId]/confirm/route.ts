import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { qrVisitEvents, qrWaitOrderItems, qrWaitOrders, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { DailyOpeningRequiredError, ensureDailyOpeningCash } from "@/lib/daily-opening-cash";
import { buildWaitOrderSnapshots, insertWaitOrderAsPosOrder, WaitOrderValidationError, type WaitOrderInputItem } from "@/lib/qr-wait-pos-order";
import { needsQrWaitPriceAcknowledgement, qrWaitOrderIsExpired } from "@/lib/qr-wait-order-policy";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ waitOrderId: string }> };

export async function POST(request: Request, { params }: Context) {
  const staff = await getCurrentStaff();
  if (!staff) return Response.json({ success: false }, { status: 401 });
  const waitOrderId = Number((await params).waitOrderId);
  if (!Number.isSafeInteger(waitOrderId) || waitOrderId <= 0) return Response.json({ success: false }, { status: 404 });
  const body = await request.json().catch(() => null) as { version?: unknown; acknowledgedTotal?: unknown } | null;
  if (!body || !Number.isSafeInteger(body.version) || (body.acknowledgedTotal !== undefined && (typeof body.acknowledgedTotal !== "string" || !/^\d{1,12}\.\d{2}$/.test(body.acknowledgedTotal))))
    return Response.json({ success: false, message: "확정 요청을 확인해 주세요." }, { status: 400 });
  try {
    const result = await db.transaction(async tx => {
      const [wait] = await tx.select({ visitorId: qrWaitOrders.visitorId, status: qrWaitOrders.status,
        version: qrWaitOrders.version, estimatedTotal: qrWaitOrders.estimatedTotal,
        assignedSessionId: qrWaitOrders.assignedSessionId, acceptedOrderId: qrWaitOrders.acceptedOrderId,
        expiresAt: qrWaitOrders.expiresAt }).from(qrWaitOrders)
        .where(eq(qrWaitOrders.waitOrderId, waitOrderId)).for("update").limit(1);
      if (!wait) throw new ConfirmError("MISSING");
      if (wait.status === "CONFIRMED" && wait.acceptedOrderId) return { kind: "ALREADY" as const, orderId: wait.acceptedOrderId };
      if (wait.status !== "ASSIGNED" || !wait.assignedSessionId || wait.version !== body.version) throw new ConfirmError("ORDER_CHANGED");
      if (qrWaitOrderIsExpired(wait.expiresAt, new Date())) throw new ConfirmError("EXPIRED");
      await ensureDailyOpeningCash(tx);
      const [session] = await tx.select({ sessionId: tableSessions.sessionId, status: tableSessions.status,
        sessionKind: tableSessions.sessionKind }).from(tableSessions)
        .where(eq(tableSessions.sessionId, wait.assignedSessionId)).for("update").limit(1);
      if (!session || session.status !== "OPEN" || session.sessionKind !== "DINE_IN") throw new ConfirmError("SESSION_CLOSED");
      const rows = await tx.select({ menuId: qrWaitOrderItems.menuId, quantity: qrWaitOrderItems.quantity,
        optionIdsJson: qrWaitOrderItems.optionIdsJson }).from(qrWaitOrderItems)
        .where(eq(qrWaitOrderItems.waitOrderId, waitOrderId)).for("update");
      let items: WaitOrderInputItem[];
      try {
        items = rows.map(row => ({ menuId: row.menuId, qty: row.quantity,
          options: JSON.parse(row.optionIdsJson) as WaitOrderInputItem["options"] }));
      } catch { throw new WaitOrderValidationError("대기 주문 옵션을 읽지 못했습니다."); }
      const current = await buildWaitOrderSnapshots(tx, items);
      if (needsQrWaitPriceAcknowledgement(wait.estimatedTotal, current.total, body.acknowledgedTotal)) {
        return { kind: "PRICE_CHANGED" as const, oldTotal: wait.estimatedTotal, currentTotal: current.total, version: wait.version };
      }
      const orderId = await insertWaitOrderAsPosOrder(tx, session.sessionId, staff.staffId, current.snapshots, current.total);
      await tx.update(qrWaitOrders).set({ status: "CONFIRMED", acceptedOrderId: orderId, confirmedAt: new Date(),
        updatedAt: new Date(), version: wait.version + 1 }).where(and(eq(qrWaitOrders.waitOrderId, waitOrderId),
          eq(qrWaitOrders.status, "ASSIGNED"), eq(qrWaitOrders.version, wait.version)));
      return { kind: "CONFIRMED" as const, orderId, visitorId: wait.visitorId, total: current.total };
    });
    if (result.kind === "PRICE_CHANGED") return Response.json({ success: false, priceChanged: true,
      estimatedTotal: result.oldTotal, currentTotal: result.currentTotal, version: result.version,
      message: "현재 메뉴 가격이 대기 주문 예상 금액과 달라졌습니다. 금액을 확인한 뒤 다시 확정해 주세요." }, { status: 409 });
    if (result.kind === "ALREADY") return Response.json({ success: true, alreadyConfirmed: true, orderId: result.orderId }, { headers: { "Cache-Control": "no-store" } });
    try {
      await db.insert(qrVisitEvents).values({ visitorId: result.visitorId, waitOrderId, orderId: result.orderId,
        clientEventId: randomUUID(), source: "WAITING", eventType: "ORDER_CONFIRMED", menuId: null,
        optionIdsJson: "[]", quantityBefore: 0, quantityDelta: 0, quantityAfter: 0,
        estimatedUnitPrice: null, estimatedLineTotal: result.total, occurredAt: new Date() });
    } catch { console.error("QR wait confirmation analytics skipped"); }
    return Response.json({ success: true, orderId: result.orderId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DailyOpeningRequiredError) return Response.json({ success: false, openingRequired: true, message: error.message }, { status: 428 });
    if (error instanceof WaitOrderValidationError) return Response.json({ success: false, message: error.message }, { status: 409 });
    if (error instanceof ConfirmError) {
      const messages: Record<string, string> = { MISSING: "대기 주문을 찾을 수 없습니다.", ORDER_CHANGED: "대기 주문 상태가 바뀌었습니다. 새로고침해 주세요.", EXPIRED: "대기 주문이 만료되었습니다.", SESSION_CLOSED: "배정한 테이블 세션이 종료되었습니다." };
      return Response.json({ success: false, message: messages[error.message] ?? "대기 주문을 확정할 수 없습니다." }, { status: 409 });
    }
    console.error("POS QR wait order confirmation failed", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "대기 주문 확정에 실패했습니다." }, { status: 503 });
  }
}

class ConfirmError extends Error {}
