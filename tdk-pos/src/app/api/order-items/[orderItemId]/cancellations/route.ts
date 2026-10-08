import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { orderItemCancellations, orderItems, orders, staff, tableSessions } from "@/db/schema";
import { getCurrentStaff, verifyPin } from "@/lib/auth";
import { shouldRequireCancellationPin } from "@/lib/cancellation-auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { syncRiceOrderItemStock } from "@/lib/rice-stock";

const reasons = new Set(["고객 요청", "주문 실수", "조리 불량", "이물질", "클레임", "기타"]);
const cents = (value: string) => Math.round(Number(value) * 100);
const decimal = (value: number) => (value / 100).toFixed(2);

export async function POST(request: Request, { params }: { params: Promise<{ orderItemId: string }> }) {
  const current = await getCurrentStaff();
  const sharedMode = await getPosLoginMode() === "SHARED";
  if (!current && !sharedMode) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  try {
    const orderItemId = Number((await params).orderItemId); const body = await request.json() as { qty?: unknown; reason?: unknown; detail?: unknown; staffCode?: unknown; pin?: unknown };
    const qty = Number(body.qty); const reason = typeof body.reason === "string" ? body.reason : ""; const detail = typeof body.detail === "string" ? body.detail.trim() : "";
    if (!Number.isInteger(orderItemId) || orderItemId <= 0 || !Number.isInteger(qty) || qty <= 0 || !reasons.has(reason) || (reason === "기타" && !detail)) return Response.json({ success: false, message: "취소 정보를 확인하세요." }, { status: 400 });
    const result = await db.transaction(async tx => {
      await tx.execute(sql`SELECT order_item_id FROM order_items WHERE order_item_id = ${orderItemId} FOR UPDATE`);
      const [item] = await tx.select({ id: orderItems.orderItemId, orderId: orderItems.orderId, menuId: orderItems.menuId, sessionId: orders.sessionId, qty: sql<number>`COALESCE(${orderItems.actualComponentQty}, ${orderItems.qty})`, unitPrice: orderItems.unitPrice, itemType: orderItems.itemType, status: orderItems.status, orderedAt: orderItems.orderedAt, orderStatus: orders.status, sessionStatus: tableSessions.status }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.orderId)).innerJoin(tableSessions, eq(orders.sessionId, tableSessions.sessionId)).where(eq(orderItems.orderItemId, orderItemId)).limit(1);
      if (!item || item.sessionStatus !== "OPEN" || item.orderStatus === "COMPLETED") throw new Error("취소할 수 없는 주문입니다.");
      const [cancelled] = await Promise.all([tx.select({ qty: orderItemCancellations.cancelledQty }).from(orderItemCancellations).where(eq(orderItemCancellations.orderItemId, orderItemId))]);
      const sessionItems = await tx.select({ orderItemId: orderItems.orderItemId, qty: sql<number>`COALESCE(${orderItems.actualComponentQty}, ${orderItems.qty})` }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.orderId)).where(and(eq(orders.sessionId, item.sessionId), ne(orders.status, "COMPLETED")));
      const sessionCancellationRows = sessionItems.length ? await tx.select({ orderItemId: orderItemCancellations.orderItemId, qty: orderItemCancellations.cancelledQty }).from(orderItemCancellations).where(inArray(orderItemCancellations.orderItemId, sessionItems.map(row => row.orderItemId))) : [];
      const cancelledByItem = new Map<number, number>();
      for (const row of sessionCancellationRows) cancelledByItem.set(row.orderItemId, (cancelledByItem.get(row.orderItemId) ?? 0) + row.qty);
      const fullOrderCancellation = sessionItems.length > 0 && sessionItems.every(row => row.qty - (cancelledByItem.get(row.orderItemId) ?? 0) - (row.orderItemId === orderItemId ? qty : 0) === 0);
      const needsReauth = shouldRequireCancellationPin(fullOrderCancellation);
      const [sharedStaff] = sharedMode ? await tx.select({ staffId: staff.staffId }).from(staff).where(and(eq(staff.staffCode, "000"), eq(staff.isActive, 1))).limit(1) : [];
      let cancelledBy = sharedMode ? sharedStaff?.staffId : current?.staffId;
      if (needsReauth) { if (typeof body.staffCode !== "string" || typeof body.pin !== "string") return { reauth: true as const }; const [checker] = await tx.select({ id: staff.staffId, pin: staff.pinHash }).from(staff).where(and(eq(staff.staffCode, body.staffCode.trim()), eq(staff.isActive, 1))).limit(1); if (!checker || body.staffCode.trim() === "000" || !(await verifyPin(body.pin, checker.pin))) throw new Error("직원번호 또는 PIN이 올바르지 않습니다."); cancelledBy = checker.id; }
      if (!cancelledBy) throw new Error(sharedMode ? "매장 공용 취소 계정을 찾을 수 없습니다." : "취소 처리 직원이 필요합니다.");
      const used = cancelled.reduce((sum, row) => sum + row.qty, 0); if (qty > item.qty - used) throw new Error("취소 가능 수량을 초과했습니다.");
      const amount = item.itemType === "SERVICE" ? 0 : cents(item.unitPrice) * qty; await tx.insert(orderItemCancellations).values({ orderItemId, cancelledQty: qty, cancelledAmount: decimal(amount), cancellationReason: reason === "기타" ? detail : reason, cancelledByStaffId: cancelledBy });
      const remaining = item.qty - used - qty; if (remaining === 0) await tx.update(orderItems).set({ status: "CANCELLED", cancelledAt: new Date(), cancelledByStaffId: cancelledBy }).where(eq(orderItems.orderItemId, orderItemId));
      await syncRiceOrderItemStock(tx, orderItemId, item.menuId, remaining, cancelledBy);
      const all = await tx.select({ id: orderItems.orderItemId, total: orderItems.totalAmount }).from(orderItems).where(eq(orderItems.orderId, item.orderId)); const ids = all.map(row => row.id); const allCancels = ids.length ? await tx.select({ id: orderItemCancellations.orderItemId, amount: orderItemCancellations.cancelledAmount }).from(orderItemCancellations).where(inArray(orderItemCancellations.orderItemId, ids)) : []; const total = all.reduce((sum, row) => sum + cents(row.total), 0) - allCancels.reduce((sum, row) => sum + cents(row.amount), 0); await tx.update(orders).set({ subtotalAmount: decimal(total), totalAmount: decimal(total), status: total === 0 ? "CANCELLED" : item.orderStatus }).where(eq(orders.orderId, item.orderId)); return { reauth: false as const, remaining };
    });
    if (result.reauth) return Response.json({ success: false, reauth: true, message: "취소자 확인이 필요합니다." }, { status: 401 }); return Response.json({ success: true, remainingQty: result.remaining });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "주문 취소에 실패했습니다." }, { status: 409 }); }
}
