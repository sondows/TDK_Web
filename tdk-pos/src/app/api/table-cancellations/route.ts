import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { diningTables, orderItemCancellations, orderItems, orders, staff, tableSessionMerges, tableSessions } from "@/db/schema";
import { getCurrentStaff, verifyPin } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { isValidPin } from "@/lib/pin";
import { syncRiceOrderItemStock } from "@/lib/rice-stock";

const reasons = new Set(["고객 요청", "주문 실수", "조리 불량", "서비스", "에러", "기타"]);
const cents = (value: string) => Math.round(Number(value) * 100);
const decimal = (value: number) => (value / 100).toFixed(2);

type Scope = { sessionIds: number[]; tableNos: string[]; total: number; mergeIds: number[] };

async function resolveScope(tableId: number): Promise<Scope> {
  const work = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    const [base] = await tx.select({ sessionId: tableSessions.sessionId, groupId: tableSessions.groupId })
      .from(tableSessions)
      .where(and(eq(tableSessions.tableId, tableId), eq(tableSessions.status, "OPEN"))).limit(1);
    if (!base) throw new Error("사용 중인 테이블을 선택해 주세요.");

    const partySessions = await tx.select({ sessionId: tableSessions.sessionId, tableId: tableSessions.tableId })
      .from(tableSessions)
      .where(base.groupId === null ? and(eq(tableSessions.sessionId, base.sessionId), eq(tableSessions.status, "OPEN")) : and(eq(tableSessions.groupId, base.groupId), eq(tableSessions.status, "OPEN")));
    const partySessionIds = partySessions.map(session => session.sessionId);

    const merges = partySessionIds.length ? await tx.select({ mergeId: tableSessionMerges.mergeId, sourceSessionId: tableSessionMerges.sourceSessionId })
      .from(tableSessionMerges)
      .where(and(eq(tableSessionMerges.status, "ACTIVE"), inArray(tableSessionMerges.destinationSessionId, partySessionIds))) : [];
    const sessionIds = [...new Set([...partySessionIds, ...merges.map(merge => merge.sourceSessionId)])];

    const sessionRows = await tx.select({ sessionId: tableSessions.sessionId, tableNo: diningTables.tableNo })
      .from(tableSessions).innerJoin(diningTables, eq(tableSessions.tableId, diningTables.tableId))
      .where(inArray(tableSessions.sessionId, sessionIds));
    const tableNos = sessionRows.map(row => row.tableNo).sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));

    const scopeOrders = sessionIds.length ? await tx.select({ orderId: orders.orderId, status: orders.status })
      .from(orders).where(inArray(orders.sessionId, sessionIds)) : [];
    if (scopeOrders.some(order => order.status === "COMPLETED")) throw new Error("결제 완료 주문이 포함되어 테이블 취소를 처리할 수 없습니다.");
    const orderIds = scopeOrders.map(order => order.orderId);
    const scopeItems = orderIds.length ? await tx.select({ orderItemId: orderItems.orderItemId, qty: orderItems.qty, unitPrice: orderItems.unitPrice })
      .from(orderItems).where(inArray(orderItems.orderId, orderIds)) : [];
    const itemIds = scopeItems.map(item => item.orderItemId);
    const cancellationRows = itemIds.length ? await tx.select({ orderItemId: orderItemCancellations.orderItemId, cancelledQty: orderItemCancellations.cancelledQty })
      .from(orderItemCancellations).where(inArray(orderItemCancellations.orderItemId, itemIds)) : [];
    const cancelledByItem = new Map<number, number>();
    cancellationRows.forEach(row => cancelledByItem.set(row.orderItemId, (cancelledByItem.get(row.orderItemId) ?? 0) + row.cancelledQty));
    const total = scopeItems.reduce((sum, item) => sum + Math.max(0, item.qty - (cancelledByItem.get(item.orderItemId) ?? 0)) * Number(item.unitPrice), 0);
    return { sessionIds, tableNos, total, mergeIds: merges.map(merge => merge.mergeId) };
  };
  return db.transaction(work);
}

export async function POST(request: Request) {
  const current = await getCurrentStaff();
  const sharedMode = await getPosLoginMode() === "SHARED";
  if (!current && !sharedMode) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });

  try {
    const body = await request.json() as { tableId?: unknown; staffCode?: unknown; pin?: unknown; reason?: unknown; detail?: unknown };
    const tableId = Number(body.tableId);
    if (!Number.isInteger(tableId) || tableId <= 0) return Response.json({ success: false, message: "취소할 테이블을 확인해 주세요." }, { status: 400 });

    if (typeof body.staffCode !== "string" || typeof body.pin !== "string") {
      const preview = await resolveScope(tableId);
      return Response.json({ success: true, preview: true, tableNos: preview.tableNos, total: preview.total });
    }

    const staffCode = body.staffCode.trim();
    const pin = body.pin;
    const reason = typeof body.reason === "string" ? body.reason : "";
    const detail = typeof body.detail === "string" ? body.detail.trim() : "";
    if (!isValidPin(pin) || !reasons.has(reason) || (reason === "기타" && !detail)) {
      return Response.json({ success: false, message: "직원 PIN과 취소 사유를 확인해 주세요." }, { status: 400 });
    }

    const result = await db.transaction(async tx => {
      const [checker] = await tx.select({ staffId: staff.staffId, pinHash: staff.pinHash })
        .from(staff).where(and(eq(staff.staffCode, staffCode), eq(staff.isActive, 1))).limit(1);
      if (!checker || staffCode === "000" || !(await verifyPin(pin, checker.pinHash))) throw new Error("직원번호 또는 PIN이 올바르지 않습니다.");

      // Recalculate under locks; preview values are never trusted for execution.
      const base = await tx.select({ sessionId: tableSessions.sessionId, groupId: tableSessions.groupId })
        .from(tableSessions).where(and(eq(tableSessions.tableId, tableId), eq(tableSessions.status, "OPEN"))).for("update").limit(1);
      const selected = base[0];
      if (!selected) throw new Error("테이블 상태가 변경되었습니다. 다시 확인해 주세요.");
      const partySessions = await tx.select({ sessionId: tableSessions.sessionId })
        .from(tableSessions)
        .where(selected.groupId === null ? and(eq(tableSessions.sessionId, selected.sessionId), eq(tableSessions.status, "OPEN")) : and(eq(tableSessions.groupId, selected.groupId), eq(tableSessions.status, "OPEN")))
        .for("update");
      const partySessionIds = partySessions.map(session => session.sessionId);
      const merges = partySessionIds.length ? await tx.select({ mergeId: tableSessionMerges.mergeId, sourceSessionId: tableSessionMerges.sourceSessionId })
        .from(tableSessionMerges).where(and(eq(tableSessionMerges.status, "ACTIVE"), inArray(tableSessionMerges.destinationSessionId, partySessionIds))).for("update") : [];
      const sessionIds = [...new Set([...partySessionIds, ...merges.map(merge => merge.sourceSessionId)])];
      const sessions = await tx.select({ sessionId: tableSessions.sessionId, status: tableSessions.status, tableNo: diningTables.tableNo })
        .from(tableSessions).innerJoin(diningTables, eq(tableSessions.tableId, diningTables.tableId)).where(inArray(tableSessions.sessionId, sessionIds)).for("update");
      if (sessions.length !== sessionIds.length || sessions.some(session => session.status !== "OPEN")) throw new Error("테이블 상태가 변경되었습니다. 다시 확인해 주세요.");

      const scopeOrders = await tx.select({ orderId: orders.orderId, status: orders.status })
        .from(orders).where(inArray(orders.sessionId, sessionIds)).for("update");
      if (scopeOrders.some(order => order.status === "COMPLETED")) throw new Error("결제 완료 주문이 포함되어 테이블 취소를 처리할 수 없습니다.");
      const orderIds = scopeOrders.map(order => order.orderId);
      const scopeItems = orderIds.length ? await tx.select({ orderItemId: orderItems.orderItemId, orderId: orderItems.orderId, menuId: orderItems.menuId, qty: sql<number>`COALESCE(${orderItems.actualComponentQty}, ${orderItems.qty})`, unitPrice: orderItems.unitPrice })
        .from(orderItems).where(inArray(orderItems.orderId, orderIds)).for("update") : [];
      const itemIds = scopeItems.map(item => item.orderItemId);
      const cancellations = itemIds.length ? await tx.select({ orderItemId: orderItemCancellations.orderItemId, cancelledQty: orderItemCancellations.cancelledQty })
        .from(orderItemCancellations).where(inArray(orderItemCancellations.orderItemId, itemIds)) : [];
      const cancelledByItem = new Map<number, number>();
      cancellations.forEach(row => cancelledByItem.set(row.orderItemId, (cancelledByItem.get(row.orderItemId) ?? 0) + row.cancelledQty));

      for (const item of scopeItems) {
        const effectiveQty = Math.max(0, item.qty - (cancelledByItem.get(item.orderItemId) ?? 0));
        if (!effectiveQty) continue;
        await tx.insert(orderItemCancellations).values({ orderItemId: item.orderItemId, cancelledQty: effectiveQty, cancelledAmount: decimal(cents(item.unitPrice) * effectiveQty), cancellationReason: reason === "기타" ? detail : reason, cancelledByStaffId: checker.staffId });
        await tx.update(orderItems).set({ status: "CANCELLED", cancelledAt: new Date(), cancelledByStaffId: checker.staffId }).where(eq(orderItems.orderItemId, item.orderItemId));
        await syncRiceOrderItemStock(tx, item.orderItemId, item.menuId, 0, checker.staffId);
      }
      for (const orderId of orderIds) await tx.update(orders).set({ subtotalAmount: "0.00", totalAmount: "0.00", status: "CANCELLED" }).where(eq(orders.orderId, orderId));
      if (merges.length) await tx.update(tableSessionMerges).set({ status: "SEPARATED", separatedAt: new Date() }).where(inArray(tableSessionMerges.mergeId, merges.map(merge => merge.mergeId)));
      await tx.update(tableSessions).set({ status: "CANCELLED", closedAt: new Date(), closedByStaffId: checker.staffId }).where(inArray(tableSessions.sessionId, sessionIds));

      return { tableNos: sessions.map(session => session.tableNo).sort((a, b) => a.localeCompare(b, "ko", { numeric: true })) };
    });
    return Response.json({ success: true, tableNos: result.tableNos });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "테이블 취소에 실패했습니다." }, { status: 409 });
  }
}
