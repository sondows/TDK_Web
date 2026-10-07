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

type CancellationRequest = { orderItemId: number; qty: number };

export async function POST(request: Request) {
  const current = await getCurrentStaff();
  const sharedMode = await getPosLoginMode() === "SHARED";
  if (!current && !sharedMode) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });

  try {
    const body = await request.json() as { cancellations?: unknown; reason?: unknown; detail?: unknown; staffCode?: unknown; pin?: unknown };
    const cancellations = Array.isArray(body.cancellations) ? body.cancellations.map(value => value as Partial<CancellationRequest>) : [];
    const reason = typeof body.reason === "string" ? body.reason : "";
    const detail = typeof body.detail === "string" ? body.detail.trim() : "";
    const normalized = cancellations.map(value => ({ orderItemId: Number(value.orderItemId), qty: Number(value.qty) }));
    const uniqueIds = new Set(normalized.map(value => value.orderItemId));
    if (!normalized.length || uniqueIds.size !== normalized.length || normalized.some(value => !Number.isInteger(value.orderItemId) || value.orderItemId <= 0 || !Number.isInteger(value.qty) || value.qty <= 0) || !reasons.has(reason) || (reason === "기타" && !detail)) {
      return Response.json({ success: false, message: "취소 정보를 확인하세요." }, { status: 400 });
    }

    const result = await db.transaction(async tx => {
      const sorted = [...normalized].sort((a, b) => a.orderItemId - b.orderItemId);
      for (const item of sorted) await tx.execute(sql`SELECT order_item_id FROM order_items WHERE order_item_id = ${item.orderItemId} FOR UPDATE`);

      const rows = await tx.select({
        orderItemId: orderItems.orderItemId,
        menuId: orderItems.menuId,
        parentOrderItemId: orderItems.parentOrderItemId,
        orderId: orderItems.orderId,
        sessionId: orders.sessionId,
        qty: sql<number>`COALESCE(${orderItems.actualComponentQty}, ${orderItems.qty})`,
        unitPrice: orderItems.unitPrice,
        orderedAt: orderItems.orderedAt,
        orderStatus: orders.status,
        sessionStatus: tableSessions.status,
      }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.orderId)).innerJoin(tableSessions, eq(orders.sessionId, tableSessions.sessionId)).where(inArray(orderItems.orderItemId, sorted.map(item => item.orderItemId)));
      if (rows.length !== sorted.length || rows.some(row => row.sessionStatus !== "OPEN" || row.orderStatus === "COMPLETED") || new Set(rows.map(row => row.sessionId)).size !== 1) throw new Error("취소할 수 없는 주문이 포함되어 있습니다.");

      const selectedSessionId = rows[0]?.sessionId;
      const sessionItems = selectedSessionId === undefined ? [] : await tx.select({ orderItemId: orderItems.orderItemId, qty: sql<number>`COALESCE(${orderItems.actualComponentQty}, ${orderItems.qty})` }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.orderId)).where(and(eq(orders.sessionId, selectedSessionId), ne(orders.status, "COMPLETED")));
      const sessionCancellationRows = sessionItems.length ? await tx.select({ orderItemId: orderItemCancellations.orderItemId, qty: orderItemCancellations.cancelledQty }).from(orderItemCancellations).where(inArray(orderItemCancellations.orderItemId, sessionItems.map(item => item.orderItemId))) : [];
      const existingCancelledByItem = new Map<number, number>();
      for (const row of sessionCancellationRows) existingCancelledByItem.set(row.orderItemId, (existingCancelledByItem.get(row.orderItemId) ?? 0) + row.qty);
      const requestedByItem = new Map(sorted.map(item => [item.orderItemId, item.qty]));
      const parentRequests = sorted.filter(item => rows.some(row => row.orderItemId === item.orderItemId && row.parentOrderItemId === null));
      if (parentRequests.length) await tx.execute(sql`SELECT order_item_id FROM order_items WHERE parent_order_item_id IN (${sql.join(parentRequests.map(item => sql`${item.orderItemId}`), sql`, `)}) FOR UPDATE`);
      const componentRows = parentRequests.length ? await tx.select({
        orderItemId: orderItems.orderItemId,
        menuId: orderItems.menuId,
        parentOrderItemId: orderItems.parentOrderItemId,
        orderId: orderItems.orderId,
        sessionId: orders.sessionId,
        qty: sql<number>`COALESCE(${orderItems.actualComponentQty}, ${orderItems.qty})`,
        unitPrice: orderItems.unitPrice,
        orderedAt: orderItems.orderedAt,
        orderStatus: orders.status,
        sessionStatus: tableSessions.status,
      }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.orderId)).innerJoin(tableSessions, eq(orders.sessionId, tableSessions.sessionId)).where(inArray(orderItems.parentOrderItemId, parentRequests.map(item => item.orderItemId))) : [];
      const expandedRequests = new Map(requestedByItem);
      for (const parentRequest of parentRequests) {
        const parent = rows.find(row => row.orderItemId === parentRequest.orderItemId);
        if (!parent || parent.qty <= 0) continue;
        const parentPreviouslyCancelled = existingCancelledByItem.get(parent.orderItemId) ?? 0;
        const targetParentCancelled = Math.min(parent.qty, parentPreviouslyCancelled + parentRequest.qty);
        for (const component of componentRows.filter(row => row.parentOrderItemId === parent.orderItemId)) {
          const targetComponentCancelled = Math.min(component.qty, Math.ceil(component.qty * targetParentCancelled / parent.qty));
          const componentPreviouslyCancelled = existingCancelledByItem.get(component.orderItemId) ?? 0;
          const explicitlyRequested = expandedRequests.get(component.orderItemId) ?? 0;
          const automaticQty = Math.max(0, targetComponentCancelled - componentPreviouslyCancelled - explicitlyRequested);
          if (automaticQty > 0) expandedRequests.set(component.orderItemId, explicitlyRequested + automaticQty);
        }
      }
      const effectiveSorted = [...expandedRequests].map(([orderItemId, qty]) => ({ orderItemId, qty })).sort((a, b) => a.orderItemId - b.orderItemId);
      const effectiveRows = [...rows, ...componentRows.filter(row => !rows.some(existing => existing.orderItemId === row.orderItemId))];
      const effectiveRequestedByItem = new Map(effectiveSorted.map(item => [item.orderItemId, item.qty]));
      const isFullOrderCancellation = sessionItems.length > 0 && sessionItems.every(item => item.qty - (existingCancelledByItem.get(item.orderItemId) ?? 0) - (effectiveRequestedByItem.get(item.orderItemId) ?? 0) === 0);
      const requiresReauth = shouldRequireCancellationPin(isFullOrderCancellation);
      const [sharedStaff] = sharedMode ? await tx.select({ staffId: staff.staffId }).from(staff).where(and(eq(staff.staffCode, "000"), eq(staff.isActive, 1))).limit(1) : [];
      let cancelledByStaffId = sharedMode ? sharedStaff?.staffId : current?.staffId;
      if (requiresReauth) {
        if (typeof body.staffCode !== "string" || typeof body.pin !== "string") return { reauth: true as const, isFullOrderCancellation };
        const [checker] = await tx.select({ staffId: staff.staffId, pinHash: staff.pinHash }).from(staff).where(and(eq(staff.staffCode, body.staffCode.trim()), eq(staff.isActive, 1))).limit(1);
        if (!checker || body.staffCode.trim() === "000" || !(await verifyPin(body.pin, checker.pinHash))) throw new Error("직원번호 또는 PIN이 올바르지 않습니다.");
        cancelledByStaffId = checker.staffId;
      }
      if (!cancelledByStaffId) throw new Error(sharedMode ? "매장 공용 취소 계정을 찾을 수 없습니다." : "취소 처리 직원이 필요합니다.");

      const cancelledRows = await tx.select({ orderItemId: orderItemCancellations.orderItemId, qty: orderItemCancellations.cancelledQty }).from(orderItemCancellations).where(inArray(orderItemCancellations.orderItemId, effectiveSorted.map(item => item.orderItemId)));
      const cancelledByItem = new Map<number, number>();
      for (const row of cancelledRows) cancelledByItem.set(row.orderItemId, (cancelledByItem.get(row.orderItemId) ?? 0) + row.qty);

      for (const requestItem of effectiveSorted) {
        const row = effectiveRows.find(value => value.orderItemId === requestItem.orderItemId);
        if (!row) throw new Error("주문 항목을 찾을 수 없습니다.");
        const remaining = row.qty - (cancelledByItem.get(row.orderItemId) ?? 0);
        if (requestItem.qty > remaining) throw new Error("취소 가능 수량을 초과했습니다.");
        const amount = cents(row.unitPrice) * requestItem.qty;
        await tx.insert(orderItemCancellations).values({ orderItemId: row.orderItemId, cancelledQty: requestItem.qty, cancelledAmount: decimal(amount), cancellationReason: reason === "기타" ? detail : reason, cancelledByStaffId });
        if (requestItem.qty === remaining) await tx.update(orderItems).set({ status: "CANCELLED", cancelledAt: new Date(), cancelledByStaffId }).where(eq(orderItems.orderItemId, row.orderItemId));
        await syncRiceOrderItemStock(tx, row.orderItemId, row.menuId, remaining - requestItem.qty, cancelledByStaffId);
      }

      const affectedOrderIds = [...new Set(effectiveRows.map(row => row.orderId))];
      for (const orderId of affectedOrderIds) {
        const allItems = await tx.select({ orderItemId: orderItems.orderItemId, totalAmount: orderItems.totalAmount }).from(orderItems).where(eq(orderItems.orderId, orderId));
        const allCancellationRows = allItems.length ? await tx.select({ cancelledAmount: orderItemCancellations.cancelledAmount }).from(orderItemCancellations).where(inArray(orderItemCancellations.orderItemId, allItems.map(item => item.orderItemId))) : [];
        const remainingTotal = allItems.reduce((sum, item) => sum + cents(item.totalAmount), 0) - allCancellationRows.reduce((sum, item) => sum + cents(item.cancelledAmount), 0);
        const source = effectiveRows.find(row => row.orderId === orderId);
        await tx.update(orders).set({ subtotalAmount: decimal(remainingTotal), totalAmount: decimal(remainingTotal), status: remainingTotal === 0 ? "CANCELLED" : source?.orderStatus }).where(eq(orders.orderId, orderId));
      }
      return { reauth: false as const, isFullOrderCancellation };
    });

    if (result.reauth) return Response.json({ success: false, reauth: true, fullOrderCancellation: result.isFullOrderCancellation, message: "취소자 확인이 필요합니다." }, { status: 401 });
    return Response.json({ success: true, fullOrderCancellation: result.isFullOrderCancellation });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "주문 취소에 실패했습니다." }, { status: 409 });
  }
}
