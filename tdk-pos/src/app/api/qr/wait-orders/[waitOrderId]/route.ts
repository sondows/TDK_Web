import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, qrWaitOrderItems, qrWaitOrders, tableSessions } from "@/db/schema";
import { loadQrMenuCatalog } from "@/lib/qr-menu-catalog";
import { configuredQrVisitTtlDays, enrichQrCatalog, QR_WAIT_ORDER_COOKIE_PATH, qrWaitOrderDisplayId, validateQrWaitCart } from "@/lib/qr-wait-order-data";
import { isSameOriginQrRequest, qrCookieAttributes, readRequestCookie, resolveQrVisitor } from "@/lib/qr-visit-session";
import { canCancelQrWaitOrder, canEditQrWaitOrder, qrWaitOrderIsExpired } from "@/lib/qr-wait-order-policy";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ waitOrderId: string }> };

async function authorize(request: Request, rawId: string) {
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) return { error: Response.json({ success: false }, { status: 404 }) } as const;
  const token = readRequestCookie(request, qrWaitOrderDisplayId(id));
  if (!token || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) return { error: Response.json({ success: false }, { status: 404 }) } as const;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [order] = await db.select({ waitOrderId: qrWaitOrders.waitOrderId, accessTokenHash: qrWaitOrders.accessTokenHash,
    status: qrWaitOrders.status, version: qrWaitOrders.version, publicReference: qrWaitOrders.publicReference,
    estimatedTotal: qrWaitOrders.estimatedTotal, createdAt: qrWaitOrders.createdAt, expiresAt: qrWaitOrders.expiresAt })
    .from(qrWaitOrders).where(eq(qrWaitOrders.waitOrderId, id)).limit(1);
  if (!order || order.accessTokenHash !== tokenHash) return { error: Response.json({ success: false }, { status: 404 }) } as const;
  const safeOrder = { waitOrderId: order.waitOrderId, status: order.status, version: order.version,
    publicReference: order.publicReference, estimatedTotal: order.estimatedTotal, createdAt: order.createdAt, expiresAt: order.expiresAt };
  return { order: safeOrder, token } as const;
}

export async function GET(request: Request, { params }: Context) {
  try {
    const auth = await authorize(request, (await params).waitOrderId);
    if ("error" in auth) return auth.error;
    const now = new Date();
    if (qrWaitOrderIsExpired(auth.order.expiresAt, now) && ["PENDING", "ASSIGNED"].includes(auth.order.status)) {
      await db.update(qrWaitOrders).set({ status: "EXPIRED", version: auth.order.version + 1, updatedAt: now })
        .where(and(eq(qrWaitOrders.waitOrderId, auth.order.waitOrderId), eq(qrWaitOrders.version, auth.order.version)));
      return Response.json({ success: true, order: { ...auth.order, status: "EXPIRED" }, items: [] }, { headers: { "Cache-Control": "no-store" } });
    }
    const items = await db.select({ menuId: qrWaitOrderItems.menuId, itemName: qrWaitOrderItems.itemName,
      quantity: qrWaitOrderItems.quantity, optionIdsJson: qrWaitOrderItems.optionIdsJson,
      estimatedUnitPrice: qrWaitOrderItems.estimatedUnitPrice, estimatedLineTotal: qrWaitOrderItems.estimatedLineTotal })
      .from(qrWaitOrderItems).where(eq(qrWaitOrderItems.waitOrderId, auth.order.waitOrderId))
      .orderBy(asc(qrWaitOrderItems.sortOrder), asc(qrWaitOrderItems.waitOrderItemId));
    return Response.json({ success: true, order: auth.order,
      items: items.map(item => ({ ...item, options: JSON.parse(item.optionIdsJson) as unknown })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("QR wait order lookup failed", { code: (error as { code?: string }).code });
    return Response.json({ success: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginQrRequest(request)) return Response.json({ success: false }, { status: 403 });
  try {
    const auth = await authorize(request, (await params).waitOrderId);
    if ("error" in auth) return auth.error;
    const body = await request.json().catch(() => null) as { version?: unknown; cart?: unknown } | null;
    if (!body || !Number.isSafeInteger(body.version) || !Array.isArray(body.cart)) return Response.json({ success: false }, { status: 400 });
    const catalog = enrichQrCatalog(await loadQrMenuCatalog());
    const lines = validateQrWaitCart(body.cart, catalog);
    if (!lines?.length) return Response.json({ success: false, message: "장바구니 메뉴와 옵션을 다시 확인해 주세요." }, { status: 409 });
    const now = new Date();
    const ttlMs = configuredQrVisitTtlDays() * 24 * 60 * 60 * 1000;
    const result = await db.transaction(async tx => {
      const [visitor] = await tx.select({ visitorId: qrWaitOrders.visitorId }).from(qrWaitOrders)
        .where(eq(qrWaitOrders.waitOrderId, auth.order.waitOrderId)).limit(1);
      if (!visitor) return "MISSING" as const;
      const visit = await resolveQrVisitor(tx, request, now, ttlMs);
      if (visit.visitorId !== visitor.visitorId) return "DENIED" as const;
      const [locked] = await tx.select({ status: qrWaitOrders.status, version: qrWaitOrders.version })
        .from(qrWaitOrders).where(eq(qrWaitOrders.waitOrderId, auth.order.waitOrderId)).for("update").limit(1);
      if (!locked || !canEditQrWaitOrder(locked.status) || locked.version !== body.version) return "CONFLICT" as const;
      await tx.delete(qrWaitOrderItems).where(eq(qrWaitOrderItems.waitOrderId, auth.order.waitOrderId));
      await tx.insert(qrWaitOrderItems).values(lines.map((entry, sortOrder) => ({ waitOrderId: auth.order.waitOrderId,
        menuId: entry.line.menuId, itemName: entry.itemName, quantity: entry.line.qty,
        optionIdsJson: JSON.stringify(entry.line.options), estimatedUnitPrice: entry.unitPrice.toFixed(2),
        estimatedLineTotal: entry.lineTotal.toFixed(2), sortOrder })));
      await tx.update(qrWaitOrders).set({ estimatedTotal: lines.reduce((sum, line) => sum + line.lineTotal, 0).toFixed(2),
        version: locked.version + 1, updatedAt: now }).where(eq(qrWaitOrders.waitOrderId, auth.order.waitOrderId));
      return "UPDATED" as const;
    });
    if (result === "DENIED" || result === "MISSING") return Response.json({ success: false }, { status: 404 });
    if (result === "CONFLICT") return Response.json({ success: false, message: "대기 주문 상태가 바뀌었습니다. 새로고침해 주세요." }, { status: 409 });
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("QR wait order update failed", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "대기 주문을 수정하지 못했습니다." }, { status: 503 });
  }
}

export async function DELETE(request: Request, { params }: Context) {
  if (!isSameOriginQrRequest(request)) return Response.json({ success: false }, { status: 403 });
  try {
    const auth = await authorize(request, (await params).waitOrderId);
    if ("error" in auth) return auth.error;
    const now = new Date();
    const result = await db.transaction(async tx => {
      const [locked] = await tx.select({ visitorId: qrWaitOrders.visitorId, status: qrWaitOrders.status,
        version: qrWaitOrders.version, assignedSessionId: qrWaitOrders.assignedSessionId }).from(qrWaitOrders).where(eq(qrWaitOrders.waitOrderId, auth.order.waitOrderId)).for("update").limit(1);
      if (!locked || !canCancelQrWaitOrder(locked.status)) return "CONFLICT" as const;
      const visit = await resolveQrVisitor(tx, request, now, configuredQrVisitTtlDays() * 24 * 60 * 60 * 1000);
      if (visit.visitorId !== locked.visitorId) return "DENIED" as const;
      await tx.update(qrWaitOrders).set({ status: "CANCELLED", cancelledAt: now, updatedAt: now,
        version: locked.version + 1, assignedSessionId: null, assignedByStaffId: null }).where(eq(qrWaitOrders.waitOrderId, auth.order.waitOrderId));
      if (locked.assignedSessionId) {
        const [existingOrder] = await tx.select({ orderId: orders.orderId }).from(orders)
          .where(eq(orders.sessionId, locked.assignedSessionId)).limit(1);
        if (!existingOrder) await tx.update(tableSessions).set({ status: "CLOSED", closedAt: now })
          .where(and(eq(tableSessions.sessionId, locked.assignedSessionId), eq(tableSessions.status, "OPEN")));
      }
      return "CANCELLED" as const;
    });
    if (result === "DENIED") return Response.json({ success: false }, { status: 404 });
    if (result === "CONFLICT") return Response.json({ success: false, message: "이미 확정되었거나 취소된 주문입니다." }, { status: 409 });
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", `tdkon_qr_wait_${auth.order.waitOrderId}=; ${qrCookieAttributes(request, 0, QR_WAIT_ORDER_COOKIE_PATH)}`);
    return Response.json({ success: true }, { headers });
  } catch (error) {
    console.error("QR wait order cancellation failed", { code: (error as { code?: string }).code });
    return Response.json({ success: false }, { status: 503 });
  }
}
