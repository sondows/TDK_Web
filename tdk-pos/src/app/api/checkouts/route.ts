import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { checkoutItems, checkouts, diningTables, orderItemCancellations, orderItems, orders, paymentMethods, payments, staff, tableSessionDiscounts, tableSessionMerges, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { captureCardPayment } from "@/lib/payment/card-payment-adapter";

type PaymentCode = "CARD" | "CASH" | "TRANSFER" | "MEAL_TICKET" | "GIFT" | "OTHER";
const paymentCodes = new Set<PaymentCode>(["CARD", "CASH", "TRANSFER", "MEAL_TICKET", "GIFT", "OTHER"]);
const won = (value: number) => Math.max(0, Math.floor(value));
const decimal = (value: number) => won(value).toFixed(2);

class CheckoutError extends Error { constructor(message: string, readonly status = 409) { super(message); } }

async function actor() {
  const current = await getCurrentStaff();
  const shared = await getPosLoginMode() === "SHARED";
  if (!current && !shared) throw new CheckoutError("로그인이 필요합니다.", 401);
  if (current) return current.staffId;
  const [sharedStaff] = await db.select({ staffId: staff.staffId }).from(staff).where(and(eq(staff.staffCode, "000"), eq(staff.isActive, 1))).limit(1);
  return sharedStaff?.staffId ?? null;
}

async function billScope(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], tableId: number) {
  const [base] = await tx.select({ sessionId: tableSessions.sessionId, groupId: tableSessions.groupId, tableNo: diningTables.tableNo })
    .from(tableSessions)
    .innerJoin(diningTables, eq(diningTables.tableId, tableSessions.tableId))
    .where(and(eq(tableSessions.tableId, tableId), eq(tableSessions.status, "OPEN")))
    .for("update")
    .limit(1);
  if (!base) throw new CheckoutError("사용 중인 테이블을 선택해 주세요.", 404);
  const groupedSessions = base.groupId === null
    ? [{ sessionId: base.sessionId, tableNo: base.tableNo }]
    : await tx.select({ sessionId: tableSessions.sessionId, tableNo: diningTables.tableNo })
      .from(tableSessions)
      .innerJoin(diningTables, eq(diningTables.tableId, tableSessions.tableId))
      .where(and(eq(tableSessions.status, "OPEN"), eq(tableSessions.groupId, base.groupId)))
      .for("update");
  const physicalSessionIds = groupedSessions.map((session) => session.sessionId);
  const merges = physicalSessionIds.length
    ? await tx.select({ sourceSessionId: tableSessionMerges.sourceSessionId })
      .from(tableSessionMerges)
      .where(and(eq(tableSessionMerges.status, "ACTIVE"), inArray(tableSessionMerges.destinationSessionId, physicalSessionIds)))
      .for("update")
    : [];
  const tableNos = groupedSessions
    .map((session) => session.tableNo)
    .sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  return {
    baseSessionId: base.sessionId,
    sessionIds: [...new Set([...physicalSessionIds, ...merges.map((row) => row.sourceSessionId)])],
    isPartyBill: base.groupId !== null && groupedSessions.length > 1,
    tableNos,
  };
}

async function currentBill(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], tableId: number) {
  const scope = await billScope(tx, tableId);
  const sessionOrders = await tx.select({ orderId: orders.orderId, status: orders.status }).from(orders).where(inArray(orders.sessionId, scope.sessionIds)).for("update");
  const orderIds = sessionOrders.filter(order => order.status !== "CANCELLED").map(order => order.orderId);
  const rows = orderIds.length ? await tx.select({ orderItemId: orderItems.orderItemId, qty: orderItems.qty, unitPrice: orderItems.unitPrice, status: orderItems.status }).from(orderItems).where(inArray(orderItems.orderId, orderIds)).for("update") : [];
  const itemIds = rows.map(row => row.orderItemId);
  const cancelled = itemIds.length ? await tx.select({ orderItemId: orderItemCancellations.orderItemId, qty: orderItemCancellations.cancelledQty }).from(orderItemCancellations).where(inArray(orderItemCancellations.orderItemId, itemIds)) : [];
  const cancelledByItem = new Map<number, number>(); cancelled.forEach(row => cancelledByItem.set(row.orderItemId, (cancelledByItem.get(row.orderItemId) ?? 0) + row.qty));
  const items = rows.map(row => ({ ...row, effectiveQty: row.status === "CANCELLED" ? 0 : Math.max(0, row.qty - (cancelledByItem.get(row.orderItemId) ?? 0)) })).filter(row => row.effectiveQty > 0);
  const gross = won(items.reduce((sum, row) => sum + row.effectiveQty * Number(row.unitPrice), 0));
  const discountRows = scope.sessionIds.length ? await tx.select({ sessionId: tableSessionDiscounts.sessionId, label: tableSessionDiscounts.label, amount: tableSessionDiscounts.discountAmount, type: tableSessionDiscounts.discountType }).from(tableSessionDiscounts).where(inArray(tableSessionDiscounts.sessionId, scope.sessionIds)) : [];
  const discounts = discountRows.map(row => ({ ...row, amount: won(Number(row.amount)) }));
  return { ...scope, items, gross, discounts, discount: won(discounts.reduce((sum, row) => sum + row.amount, 0)) };
}

async function activeCheckout(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], itemIds: number[]) {
  if (!itemIds.length) return null;
  const rows = await tx.select({ checkoutId: checkouts.checkoutId, status: checkouts.status, paidAmount: checkouts.paidAmount })
    .from(checkoutItems).innerJoin(checkouts, eq(checkoutItems.checkoutId, checkouts.checkoutId))
    .where(inArray(checkoutItems.orderItemId, itemIds)).for("update");
  const candidate = rows.find(row => row.status === "OPEN" || row.status === "PARTIALLY_PAID");
  return candidate ?? null;
}

async function activeCheckoutIds(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], itemIds: number[]) {
  if (!itemIds.length) return [];
  const rows = await tx.select({ checkoutId: checkouts.checkoutId, status: checkouts.status })
    .from(checkoutItems)
    .innerJoin(checkouts, eq(checkoutItems.checkoutId, checkouts.checkoutId))
    .where(inArray(checkoutItems.orderItemId, itemIds))
    .for("update");
  return [...new Set(rows
    .filter((row) => row.status === "OPEN" || row.status === "PARTIALLY_PAID")
    .map((row) => row.checkoutId))];
}

async function paymentStateForCheckouts(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], checkoutIds: number[]) {
  if (!checkoutIds.length) return [];
  const rows = await tx.select({ paymentId: payments.paymentId, amount: payments.amount, methodCode: paymentMethods.methodCode, methodName: paymentMethods.methodName, paidAt: payments.paidAt, approvalNo: payments.approvalNo, note: payments.note })
    .from(payments)
    .innerJoin(paymentMethods, eq(payments.paymentMethodId, paymentMethods.paymentMethodId))
    .where(and(inArray(payments.checkoutId, checkoutIds), eq(payments.status, "APPROVED")));
  return rows.map(row => {
    const amount = won(Number(row.amount));
    const cashReceipt = row.methodCode === "CASH"
      ? row.note?.match(/^현금 수령 (\d+)원 \/ 거스름돈 (\d+)원$/)
      : null;
    return {
      ...row,
      amount,
      receivedAmount: cashReceipt ? won(Number(cashReceipt[1])) : amount,
      changeAmount: cashReceipt ? won(Number(cashReceipt[2])) : 0,
      paidAt: row.paidAt.toISOString(),
    };
  });
}

async function paymentState(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], checkoutId: number) {
  return paymentStateForCheckouts(tx, [checkoutId]);
}

async function snapshot(tableId: number) {
  return db.transaction(async tx => {
    const bill = await currentBill(tx, tableId);
    const checkoutIds = await activeCheckoutIds(tx, bill.items.map(item => item.orderItemId));
    const paid = won((await paymentStateForCheckouts(tx, checkoutIds)).reduce((sum, row) => sum + row.amount, 0));
    return { bill, checkoutIds, checkoutId: checkoutIds[0] ?? null, paid, remaining: Math.max(0, bill.gross - bill.discount - paid) };
  });
}

export async function GET(request: Request) {
  try {
    await actor();
    const tableId = Number(new URL(request.url).searchParams.get("tableId"));
    if (!Number.isInteger(tableId) || tableId <= 0) throw new CheckoutError("테이블을 확인해 주세요.", 400);
    const state = await snapshot(tableId);
    const methods = await db.select({ code: paymentMethods.methodCode, name: paymentMethods.methodName, type: paymentMethods.methodType }).from(paymentMethods).where(eq(paymentMethods.isActive, 1));
    const history = state.checkoutIds.length ? await db.transaction(tx => paymentStateForCheckouts(tx, state.checkoutIds)) : [];
    return Response.json({ success: true, gross: state.bill.gross, discounts: state.bill.discounts, total: Math.max(0, state.bill.gross - state.bill.discount), paid: state.paid, remaining: state.remaining, checkoutId: state.checkoutId, payments: history, methods, isPartyBill: state.bill.isPartyBill, tableNos: state.bill.tableNos });
  } catch (error) { const e = error instanceof CheckoutError ? error : new CheckoutError("결제 정보를 불러올 수 없습니다.", 500); return Response.json({ success: false, message: e.message }, { status: e.status }); }
}

export async function POST(request: Request) {
  try {
    const processedByStaffId = await actor();
    const body = await request.json() as { tableId?: unknown; action?: unknown; amount?: unknown; methodCode?: unknown; roundUnit?: unknown; otherLabel?: unknown; paymentId?: unknown };
    const tableId = Number(body.tableId);
    if (!Number.isInteger(tableId) || tableId <= 0) throw new CheckoutError("테이블을 확인해 주세요.", 400);
    const action = body.action;
    const result = await db.transaction(async tx => {
      const bill = await currentBill(tx, tableId);
      const beforeDiscount = Math.max(0, bill.gross - bill.discount);
      if (action === "ROUND") {
        const unit = Number(body.roundUnit);
        if (unit !== 100 && unit !== 1000) throw new CheckoutError("절사 단위를 확인해 주세요.", 400);
        const amount = beforeDiscount % unit;
        if (!amount) throw new CheckoutError("적용할 절사 할인 금액이 없습니다.", 400);
        await tx.insert(tableSessionDiscounts).values({ sessionId: bill.baseSessionId, discountType: "AMOUNT", label: unit === 1000 ? "천원 단위 절사" : "백원 단위 절사", discountAmount: decimal(amount), discountRate: null, appliedByStaffId: processedByStaffId });
        const checkout = await activeCheckout(tx, bill.items.map(item => item.orderItemId));
        if (checkout) await tx.update(checkouts).set({ subtotalAmount: decimal(bill.gross), discountAmount: decimal(bill.discount + amount), totalAmount: decimal(beforeDiscount - amount) }).where(eq(checkouts.checkoutId, checkout.checkoutId));
        return { completed: false, change: 0, tableId };
      }
      if (action === "COMPLETE") {
        const checkoutIds = await activeCheckoutIds(tx, bill.items.map(item => item.orderItemId));
        const paid = won((await paymentStateForCheckouts(tx, checkoutIds)).reduce((sum, row) => sum + row.amount, 0));
        const total = Math.max(0, bill.gross - bill.discount);
        if (paid < total) throw new CheckoutError("받을금액이 남아 있어 결제를 완료할 수 없습니다.");
        if (checkoutIds.length) await tx.update(checkouts).set({ status: "PAID", completedAt: sql`CURRENT_TIMESTAMP` }).where(inArray(checkouts.checkoutId, checkoutIds));
        const orderIds = await tx.select({ orderId: orders.orderId }).from(orders).where(inArray(orders.sessionId, bill.sessionIds));
        if (orderIds.length) await tx.update(orders).set({ status: "COMPLETED" }).where(inArray(orders.orderId, orderIds.map(order => order.orderId)));
        await tx.update(tableSessions).set({ status: "CLOSED", closedAt: sql`CURRENT_TIMESTAMP`, closedByStaffId: processedByStaffId }).where(inArray(tableSessions.sessionId, bill.sessionIds));
        return { completed: true, change: 0, tendered: 0, applied: 0, tableId };
      }
      if (action === "CANCEL_PAYMENT") {
        const paymentId = Number(body.paymentId);
        if (!Number.isInteger(paymentId) || paymentId <= 0) throw new CheckoutError("취소할 결제 건을 확인해 주세요.", 400);
        const checkoutIds = await activeCheckoutIds(tx, bill.items.map(item => item.orderItemId));
        if (!checkoutIds.length) throw new CheckoutError("결제 정보가 변경되었습니다. 다시 확인해 주세요.", 409);
        const [target] = await tx.select({ paymentId: payments.paymentId, checkoutId: payments.checkoutId, status: payments.status })
          .from(payments)
          .where(and(eq(payments.paymentId, paymentId), inArray(payments.checkoutId, checkoutIds)))
          .for("update")
          .limit(1);
        if (!target || target.status !== "APPROVED") throw new CheckoutError("이미 취소되었거나 변경된 결제입니다.", 409);
        await tx.update(payments)
          .set({ status: "CANCELLED", cancelledAt: sql`CURRENT_TIMESTAMP` })
          .where(and(eq(payments.paymentId, paymentId), eq(payments.status, "APPROVED")));
        const checkoutPaid = won((await paymentState(tx, target.checkoutId)).reduce((sum, row) => sum + row.amount, 0));
        await tx.update(checkouts)
          .set({ paidAmount: decimal(checkoutPaid), status: checkoutPaid > 0 ? "PARTIALLY_PAID" : "OPEN", completedAt: null })
          .where(eq(checkouts.checkoutId, target.checkoutId));
        return { completed: false, change: 0, tendered: 0, applied: 0, tableId };
      }
      if (action !== "PAY" || typeof body.methodCode !== "string" || !paymentCodes.has(body.methodCode as PaymentCode)) throw new CheckoutError("결제 요청을 확인해 주세요.", 400);
      const methodCode = body.methodCode as PaymentCode;
      const [method] = await tx.select({ id: paymentMethods.paymentMethodId, type: paymentMethods.methodType, name: paymentMethods.methodName }).from(paymentMethods).where(and(eq(paymentMethods.methodCode, methodCode === "MEAL_TICKET" ? "MEAL_TICKET" : methodCode), eq(paymentMethods.isActive, 1))).limit(1);
      if (!method) throw new CheckoutError("사용할 수 없는 결제수단입니다.", 409);
      const checkout = await activeCheckout(tx, bill.items.map(item => item.orderItemId));
      const checkoutIds = await activeCheckoutIds(tx, bill.items.map(item => item.orderItemId));
      const paid = won((await paymentStateForCheckouts(tx, checkoutIds)).reduce((sum, row) => sum + row.amount, 0));
      const checkoutPaid = checkout ? won((await paymentState(tx, checkout.checkoutId)).reduce((sum, row) => sum + row.amount, 0)) : 0;
      const total = Math.max(0, bill.gross - bill.discount); const remaining = Math.max(0, total - paid);
      if (!remaining) throw new CheckoutError("이미 결제가 완료되었습니다.");
      const entered = Number(body.amount); const tendered = Number.isSafeInteger(entered) && entered > 0 ? entered : remaining;
      if (method.type !== "CASH" && tendered > remaining) throw new CheckoutError("남은 결제금액보다 큰 금액은 이 결제수단으로 처리할 수 없습니다.");
      const applied = method.type === "CASH" ? Math.min(tendered, remaining) : tendered;
      let checkoutId = checkout?.checkoutId;
      if (!checkoutId) {
        const [created] = await tx.insert(checkouts).values({ subtotalAmount: decimal(bill.gross), discountAmount: decimal(bill.discount), totalAmount: decimal(total), paidAmount: "0.00", status: "OPEN", createdByStaffId: processedByStaffId }).$returningId();
        checkoutId = created.checkoutId;
        if (bill.items.length) await tx.insert(checkoutItems).values(bill.items.map(item => ({ checkoutId: checkoutId!, orderItemId: item.orderItemId, qty: item.effectiveQty, unitPrice: item.unitPrice, discountAmount: "0.00", amount: decimal(item.effectiveQty * Number(item.unitPrice)) })));
      }
      const change = method.type === "CASH" ? Math.max(0, tendered - applied) : 0;
      const label = body.otherLabel === "식권" ? "식권" : undefined;
      const cardResult = method.type === "CARD" ? await captureCardPayment() : null;
      await tx.insert(payments).values({ checkoutId, paymentMethodId: method.id, amount: decimal(applied), status: "APPROVED", approvalNo: cardResult?.approvalNo ?? null, externalTransactionId: cardResult?.externalTransactionId ?? null, processedByStaffId, note: method.type === "CASH" && change ? `현금 수령 ${tendered}원 / 거스름돈 ${change}원` : cardResult ? "DEV/MOCK: VAN 단말 연동 전 수기 카드 처리" : label });
      const nextPaid = checkoutPaid + applied;
      await tx.update(checkouts).set({ subtotalAmount: decimal(bill.gross), discountAmount: decimal(bill.discount), totalAmount: decimal(total), paidAmount: decimal(nextPaid), status: "PARTIALLY_PAID", completedAt: null }).where(eq(checkouts.checkoutId, checkoutId));
      return { completed: false, change, tendered, applied, tableId };
    });
    const state = result.completed ? null : await snapshot(tableId);
    const history = state?.checkoutIds.length ? await db.transaction(tx => paymentStateForCheckouts(tx, state.checkoutIds)) : [];
    return Response.json({ success: true, ...result, state: state && { gross: state.bill.gross, discounts: state.bill.discounts, total: Math.max(0, state.bill.gross - state.bill.discount), paid: state.paid, remaining: state.remaining, checkoutId: state.checkoutId, payments: history, isPartyBill: state.bill.isPartyBill, tableNos: state.bill.tableNos } });
  } catch (error) { const e = error instanceof CheckoutError ? error : new CheckoutError("결제를 처리할 수 없습니다.", 500); return Response.json({ success: false, message: e.message }, { status: e.status }); }
}
