import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { checkoutItems, checkouts, customerPrepaidLedger, customers, diningTables, orderItemCancellations, orderItems, orders, paymentMethods, paymentMethodSettings, paymentOtherDetails, paymentSessionAllocations, payments, staff, tableSessionDiscounts, tableSessionMerges, tableSessions } from "@/db/schema";
import { resolveQuantityOverage } from "@/lib/other-payment-cash-change";
import { allocatePaymentAcrossSessions } from "@/lib/table-payment-allocation";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { captureCardPayment } from "@/lib/payment/card-payment-adapter";

type PaymentCode = "CARD" | "CASH" | "TRANSFER" | "MEAL_TICKET" | "GIFT" | "OTHER";
const paymentCodes = new Set<PaymentCode>(["CARD", "CASH", "TRANSFER", "MEAL_TICKET", "GIFT", "OTHER"]);
const won = (value: number) => Math.max(0, Math.floor(value));
const decimal = (value: number) => won(value).toFixed(2);
const signedDecimal = (value: number) => Math.trunc(value).toFixed(2);

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
  const sessionOrders = await tx.select({ orderId: orders.orderId, sessionId: orders.sessionId, status: orders.status }).from(orders).where(inArray(orders.sessionId, scope.sessionIds)).for("update");
  const orderIds = sessionOrders.filter(order => order.status !== "CANCELLED").map(order => order.orderId);
  const rows = orderIds.length ? await tx.select({ orderItemId: orderItems.orderItemId, orderId: orderItems.orderId, qty: orderItems.qty, unitPrice: orderItems.unitPrice, status: orderItems.status }).from(orderItems).where(inArray(orderItems.orderId, orderIds)).for("update") : [];
  const itemIds = rows.map(row => row.orderItemId);
  const cancelled = itemIds.length ? await tx.select({ orderItemId: orderItemCancellations.orderItemId, qty: orderItemCancellations.cancelledQty }).from(orderItemCancellations).where(inArray(orderItemCancellations.orderItemId, itemIds)) : [];
  const cancelledByItem = new Map<number, number>(); cancelled.forEach(row => cancelledByItem.set(row.orderItemId, (cancelledByItem.get(row.orderItemId) ?? 0) + row.qty));
  const orderSessionById = new Map(sessionOrders.map(order => [order.orderId, order.sessionId]));
  const items = rows.map(row => ({ ...row, sessionId: orderSessionById.get(row.orderId)!, effectiveQty: row.status === "CANCELLED" ? 0 : Math.max(0, row.qty - (cancelledByItem.get(row.orderItemId) ?? 0)) })).filter(row => row.effectiveQty > 0);
  const gross = won(items.reduce((sum, row) => sum + row.effectiveQty * Number(row.unitPrice), 0));
  const discountRows = scope.sessionIds.length ? await tx.select({ sessionId: tableSessionDiscounts.sessionId, label: tableSessionDiscounts.label, amount: tableSessionDiscounts.discountAmount, type: tableSessionDiscounts.discountType }).from(tableSessionDiscounts).where(inArray(tableSessionDiscounts.sessionId, scope.sessionIds)) : [];
  const discounts = discountRows.map(row => ({ ...row, amount: won(Number(row.amount)) }));
  const grossBySessionId = new Map<number, number>();
  items.forEach(item => grossBySessionId.set(item.sessionId, (grossBySessionId.get(item.sessionId) ?? 0) + item.effectiveQty * Number(item.unitPrice)));
  const discountBySessionId = new Map<number, number>();
  discounts.forEach(discount => discountBySessionId.set(discount.sessionId, (discountBySessionId.get(discount.sessionId) ?? 0) + discount.amount));
  const balanceBySessionId = new Map(scope.sessionIds.map(sessionId => [sessionId, Math.max(0, won((grossBySessionId.get(sessionId) ?? 0) - (discountBySessionId.get(sessionId) ?? 0)))]));
  return { ...scope, items, gross, discounts, discount: won(discounts.reduce((sum, row) => sum + row.amount, 0)), balanceBySessionId };
}

async function savePaymentSessionAllocations(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  paymentId: number,
  bill: Awaited<ReturnType<typeof currentBill>>,
  appliedAmount: number,
) {
  const rows = bill.sessionIds.length
    ? await tx.select({ sessionId: paymentSessionAllocations.sessionId, amount: paymentSessionAllocations.appliedAmount })
      .from(paymentSessionAllocations)
      .innerJoin(payments, eq(paymentSessionAllocations.paymentId, payments.paymentId))
      .where(and(inArray(paymentSessionAllocations.sessionId, bill.sessionIds), eq(payments.status, "APPROVED")))
      .for("update")
    : [];
  const paidBySessionId = new Map<number, number>();
  rows.forEach(row => paidBySessionId.set(row.sessionId, (paidBySessionId.get(row.sessionId) ?? 0) + Number(row.amount)));
  const allocations = allocatePaymentAcrossSessions({
    baseSessionId: bill.baseSessionId,
    appliedAmount,
    balanceBySessionId: bill.balanceBySessionId,
    paidBySessionId,
  });
  if (!allocations.length) throw new CheckoutError("테이블별 결제 금액을 배분할 수 없습니다.", 409);
  await tx.insert(paymentSessionAllocations).values(allocations.map(allocation => ({ paymentId, sessionId: allocation.sessionId, appliedAmount: decimal(allocation.amount) })));
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
  const rows = await tx.select({ paymentId: payments.paymentId, amount: payments.amount, appliedAmount: payments.appliedAmount, methodCode: paymentMethods.methodCode, methodName: paymentMethods.methodName, methodNameSnapshot: paymentOtherDetails.methodNameSnapshot, quantity: paymentOtherDetails.quantity, customerCouponQuantity: payments.customerCouponQuantity, customerCouponUnitAmountSnapshot: payments.customerCouponUnitAmountSnapshot, otherSubmittedAmount: paymentOtherDetails.submittedAmount, otherChangeAmount: paymentOtherDetails.cashChangeAmount, paidAt: payments.paidAt, approvalNo: payments.approvalNo, note: payments.note })
    .from(payments)
    .innerJoin(paymentMethods, eq(payments.paymentMethodId, paymentMethods.paymentMethodId))
    .leftJoin(paymentOtherDetails, eq(payments.paymentId, paymentOtherDetails.paymentId))
    .where(and(inArray(payments.checkoutId, checkoutIds), eq(payments.status, "APPROVED")));
  const ledgerRows = rows.length
    ? await tx.select({ paymentId: customerPrepaidLedger.paymentId, amount: customerPrepaidLedger.amount }).from(customerPrepaidLedger).where(inArray(customerPrepaidLedger.paymentId, rows.map(row => row.paymentId)))
    : [];
  const prepaidByPayment = new Map<number, number>();
  ledgerRows.forEach(row => {
    if (row.paymentId !== null) prepaidByPayment.set(row.paymentId, (prepaidByPayment.get(row.paymentId) ?? 0) + Number(row.amount));
  });
  return rows.map(row => {
    const amount = won(Number(row.amount));
    const cashReceipt = row.methodCode === "CASH"
      ? row.note?.match(/^현금 수령 (\d+)원 \/ 거스름돈 (\d+)원$/)
      : null;
    return {
      ...row,
      methodName: row.methodNameSnapshot ?? row.methodName,
      amount,
      appliedAmount: won(Number(row.appliedAmount)),
      prepaidCreditAmount: won(prepaidByPayment.get(row.paymentId) ?? 0),
      receivedAmount: cashReceipt ? won(Number(cashReceipt[1])) : won(Number(row.otherSubmittedAmount ?? amount)),
      changeAmount: cashReceipt ? won(Number(cashReceipt[2])) : won(Number(row.otherChangeAmount ?? 0)),
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
    const paid = won((await paymentStateForCheckouts(tx, checkoutIds)).reduce((sum, row) => sum + row.appliedAmount, 0));
    const prepaidRows = checkoutIds.length
      ? await tx.select({ total: sql<string>`COALESCE(SUM(${customerPrepaidLedger.amount}), 0)` }).from(customerPrepaidLedger).innerJoin(payments, eq(payments.paymentId, customerPrepaidLedger.paymentId)).where(inArray(payments.checkoutId, checkoutIds))
      : [];
    return { bill, checkoutIds, checkoutId: checkoutIds[0] ?? null, paid, prepaidCredit: won(Number(prepaidRows[0]?.total ?? 0)), remaining: Math.max(0, bill.gross - bill.discount - paid) };
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
    return Response.json({ success: true, gross: state.bill.gross, discounts: state.bill.discounts, total: Math.max(0, state.bill.gross - state.bill.discount), paid: state.paid, remaining: state.remaining, prepaidCredit: state.prepaidCredit, checkoutId: state.checkoutId, payments: history, methods, isPartyBill: state.bill.isPartyBill, tableNos: state.bill.tableNos });
  } catch (error) { const e = error instanceof CheckoutError ? error : new CheckoutError("결제 정보를 불러올 수 없습니다.", 500); return Response.json({ success: false, message: e.message }, { status: e.status }); }
}

export async function POST(request: Request) {
  let requestPhase = "authorization";
  try {
    const processedByStaffId = await actor();
    requestPhase = "request parsing";
    const body = await request.json() as { tableId?: unknown; action?: unknown; amount?: unknown; methodCode?: unknown; roundUnit?: unknown; otherLabel?: unknown; paymentId?: unknown; paymentMethodId?: unknown; inputValue?: unknown; customerId?: unknown; prepaidOverpaymentConfirmed?: unknown; requestKey?: unknown; couponQuantity?: unknown };
    const tableId = Number(body.tableId);
    if (!Number.isInteger(tableId) || tableId <= 0) throw new CheckoutError("테이블을 확인해 주세요.", 400);
    const action = body.action;
    const result = await db.transaction(async tx => {
      requestPhase = `load bill (${String(action)})`;
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
        const paid = won((await paymentStateForCheckouts(tx, checkoutIds)).reduce((sum, row) => sum + row.appliedAmount, 0));
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
        const [target] = await tx.select({ paymentId: payments.paymentId, checkoutId: payments.checkoutId, customerId: payments.customerId, status: payments.status })
          .from(payments)
          .where(and(eq(payments.paymentId, paymentId), inArray(payments.checkoutId, checkoutIds)))
          .for("update")
          .limit(1);
        if (!target || target.status !== "APPROVED") throw new CheckoutError("이미 취소되었거나 변경된 결제입니다.", 409);
        if (target.customerId !== null) await tx.select({ customerId: customers.customerId })
          .from(customers).where(eq(customers.customerId, target.customerId)).for("update").limit(1);
        const credits = await tx.select({ ledgerId: customerPrepaidLedger.ledgerId, customerId: customerPrepaidLedger.customerId, amount: customerPrepaidLedger.amount, entryType: customerPrepaidLedger.entryType, memo: customerPrepaidLedger.memo })
          .from(customerPrepaidLedger)
          .where(and(eq(customerPrepaidLedger.paymentId, paymentId), inArray(customerPrepaidLedger.entryType, ["CARD_OVERPAYMENT", "PAYMENT_OVERPAYMENT", "CUSTOMER_PAYMENT"])))
          .for("update");
        for (const credit of credits) {
          const [reversal] = await tx.select({ ledgerId: customerPrepaidLedger.ledgerId })
            .from(customerPrepaidLedger).where(eq(customerPrepaidLedger.reversesLedgerId, credit.ledgerId)).limit(1);
          if (!reversal) await tx.insert(customerPrepaidLedger).values({
            customerId: credit.customerId,
            paymentId,
            entryType: credit.entryType === "CARD_OVERPAYMENT" ? "CARD_OVERPAYMENT_REVERSAL" : credit.entryType === "CUSTOMER_PAYMENT" ? "CUSTOMER_PAYMENT_REVERSAL" : "PAYMENT_OVERPAYMENT_REVERSAL",
            amount: signedDecimal(-Number(credit.amount)),
            memo: credit.entryType === "CUSTOMER_PAYMENT" ? credit.memo : null,
            reversesLedgerId: credit.ledgerId,
            createdByStaffId: processedByStaffId,
          });
        }
        await tx.update(payments)
          .set({ status: "CANCELLED", cancelledAt: sql`CURRENT_TIMESTAMP` })
          .where(and(eq(payments.paymentId, paymentId), eq(payments.status, "APPROVED")));
        const checkoutPaid = won((await paymentState(tx, target.checkoutId)).reduce((sum, row) => sum + row.appliedAmount, 0));
        await tx.update(checkouts)
          .set({ paidAmount: decimal(checkoutPaid), status: checkoutPaid > 0 ? "PARTIALLY_PAID" : "OPEN", completedAt: null })
          .where(eq(checkouts.checkoutId, target.checkoutId));
        return { completed: false, change: 0, tendered: 0, applied: 0, tableId };
      }
      if (action === "PAY_CUSTOMER") {
        requestPhase = "validate customer payment";
        const customerId = Number(body.customerId);
        const amount = Number(body.amount);
        const couponQuantity = body.couponQuantity === undefined || body.couponQuantity === null ? null : Number(body.couponQuantity);
        const requestKey = body.requestKey;
        if (!Number.isSafeInteger(customerId) || customerId <= 0 ||
          !Number.isSafeInteger(amount) || amount <= 0 || amount > 999999999999 ||
          (couponQuantity !== null && (!Number.isSafeInteger(couponQuantity) || couponQuantity <= 0 || couponQuantity > 9999)) ||
          typeof requestKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) {
          throw new CheckoutError("고객결제 요청을 확인해 주세요.", 400);
        }
        const [customer] = await tx.select({ customerId: customers.customerId, name: customers.name, usesFixedCoupon: customers.usesFixedCoupon, fixedCouponAmount: customers.fixedCouponAmount, fixedCouponBalancePolicy: customers.fixedCouponBalancePolicy, fixedCouponCashChangeEnabled: customers.fixedCouponCashChangeEnabled, fixedCouponCashChangeMinPercent: customers.fixedCouponCashChangeMinPercent })
          .from(customers)
          .where(and(eq(customers.customerId, customerId), eq(customers.isActive, 1), eq(customers.isPaymentManaged, 1)))
          .for("update").limit(1);
        if (!customer) throw new CheckoutError("결제관리 사용 중인 고객을 선택해 주세요.", 409);
        const [existingRequest] = await tx.select({ ledgerId: customerPrepaidLedger.ledgerId })
          .from(customerPrepaidLedger).where(eq(customerPrepaidLedger.requestKey, requestKey)).limit(1);
        if (existingRequest) throw new CheckoutError("이미 처리된 고객결제입니다. 결제내역을 확인해 주세요.", 409);
        const checkout = await activeCheckout(tx, bill.items.map(item => item.orderItemId));
        const checkoutIds = await activeCheckoutIds(tx, bill.items.map(item => item.orderItemId));
        const paid = won((await paymentStateForCheckouts(tx, checkoutIds)).reduce((sum, row) => sum + row.appliedAmount, 0));
        const total = Math.max(0, bill.gross - bill.discount);
        const remaining = Math.max(0, total - paid);
        if (!remaining) throw new CheckoutError("이미 결제가 완료되었습니다.");
        if (couponQuantity === null && amount > remaining) throw new CheckoutError("고객결제 금액이 받을금액보다 많습니다.", 409);
        const couponUnitAmount = couponQuantity === null ? null : Number(customer.fixedCouponAmount ?? 0);
        if (couponQuantity !== null && (customer.usesFixedCoupon !== 1 || !couponUnitAmount || !Number.isSafeInteger(couponUnitAmount) || couponUnitAmount <= 0 || amount !== couponQuantity * couponUnitAmount))
          throw new CheckoutError("고객의 정액쿠폰 설정과 결제금액이 일치하지 않습니다. 다시 선택해 주세요.", 409);
        const couponTendered = couponQuantity === null ? amount : couponQuantity * couponUnitAmount!;
        const couponApplied = Math.min(couponTendered, remaining);
        const couponOverage = couponQuantity === null ? { cashChange: 0, forfeited: 0, error: null } : resolveQuantityOverage({
          tenderedAmount: couponTendered,
          appliedAmount: couponApplied,
          balancePolicy: customer.fixedCouponBalancePolicy,
          cashChangeEnabled: customer.fixedCouponCashChangeEnabled,
          cashChangeMinPercent: customer.fixedCouponCashChangeMinPercent,
          customerId,
        });
        if (couponOverage.error === "THRESHOLD_MISSING") throw new CheckoutError("현금 거스름 기준 설정을 확인해 주세요.", 409);
        if (couponOverage.error === "THRESHOLD_NOT_MET") throw new CheckoutError(`${customer.fixedCouponCashChangeMinPercent}% 이상 사용 시 현금 거스름 가능`, 409);
        if (couponOverage.error === "CHANGE_DISABLED") throw new CheckoutError("이 쿠폰은 잔액 현금반환이 설정되어 있지 않습니다.", 409);
        const couponLedgerDebit = couponQuantity === null ? amount : couponOverage.forfeited > 0 ? couponTendered : couponApplied;
        const [method] = await tx.select({ id: paymentMethods.paymentMethodId })
          .from(paymentMethods).where(and(eq(paymentMethods.methodCode, "CUSTOMER_PAYMENT"), eq(paymentMethods.isActive, 1))).limit(1);
        if (!method) throw new CheckoutError("고객결제 수단이 설정되지 않았습니다.", 409);

        requestPhase = "create customer checkout";
        let checkoutId = checkout?.checkoutId;
        const checkoutPaid = checkout ? won((await paymentState(tx, checkout.checkoutId)).reduce((sum, row) => sum + row.appliedAmount, 0)) : 0;
        if (!checkoutId) {
          const [created] = await tx.insert(checkouts).values({ subtotalAmount: decimal(bill.gross), discountAmount: decimal(bill.discount), totalAmount: decimal(total), paidAmount: "0.00", status: "OPEN", createdByStaffId: processedByStaffId }).$returningId();
          checkoutId = created.checkoutId;
          if (bill.items.length) await tx.insert(checkoutItems).values(bill.items.map(item => ({ checkoutId: checkoutId!, orderItemId: item.orderItemId, qty: item.effectiveQty, unitPrice: item.unitPrice, discountAmount: "0.00", amount: decimal(item.effectiveQty * Number(item.unitPrice)) })));
        } else {
          const linkedItems = await tx.select({ orderItemId: checkoutItems.orderItemId })
            .from(checkoutItems).where(eq(checkoutItems.checkoutId, checkoutId)).for("update");
          const linkedIds = new Set(linkedItems.map(item => item.orderItemId));
          const addedItems = bill.items.filter(item => !linkedIds.has(item.orderItemId));
          if (addedItems.length) await tx.insert(checkoutItems).values(addedItems.map(item => ({ checkoutId: checkoutId!, orderItemId: item.orderItemId, qty: item.effectiveQty, unitPrice: item.unitPrice, discountAmount: "0.00", amount: decimal(item.effectiveQty * Number(item.unitPrice)) })));
        }
        const tableDescription = bill.tableNos.length === 1 ? `${bill.tableNos[0]}번 테이블 식사` : `${bill.tableNos.join(", ")}번 테이블 식사`;
        requestPhase = "insert customer payment and ledger";
        const couponMemo = couponQuantity === null ? "" : ` · 정액쿠폰 ${couponQuantity}장`;
        const [createdPayment] = await tx.insert(payments).values({ checkoutId, paymentMethodId: method.id, amount: decimal(couponQuantity === null ? amount : couponTendered), appliedAmount: decimal(couponApplied), customerId, customerCouponCustomerNameSnapshot: couponQuantity === null ? null : customer.name, customerCouponQuantity: couponQuantity, customerCouponUnitAmountSnapshot: couponUnitAmount === null ? null : decimal(couponUnitAmount), status: "APPROVED", processedByStaffId, note: tableDescription }).$returningId();
        await savePaymentSessionAllocations(tx, createdPayment.paymentId, bill, couponApplied);
        if (couponQuantity !== null) await tx.insert(paymentOtherDetails).values({
          paymentId: createdPayment.paymentId,
          methodNameSnapshot: `${customer.name} 정액쿠폰`,
          inputTypeSnapshot: "QUANTITY",
          quantity: couponQuantity,
          unitAmountSnapshot: decimal(couponUnitAmount!),
          submittedAmount: decimal(couponTendered),
          appliedAmount: decimal(couponApplied),
          balancePolicySnapshot: couponOverage.cashChange > 0 ? "CASH_CHANGE" : customer.fixedCouponBalancePolicy,
          cashChangeEnabledSnapshot: customer.fixedCouponCashChangeEnabled,
          cashChangeMinPercentSnapshot: customer.fixedCouponCashChangeEnabled === 1 ? customer.fixedCouponCashChangeMinPercent : null,
          cashChangeAmount: decimal(couponOverage.cashChange),
          forfeitedAmount: decimal(couponOverage.forfeited),
        });
        await tx.insert(customerPrepaidLedger).values({ customerId, paymentId: createdPayment.paymentId, entryType: "CUSTOMER_PAYMENT", amount: signedDecimal(-couponLedgerDebit), memo: `${tableDescription}${couponMemo}`, requestKey, createdByStaffId: processedByStaffId });
        const nextPaid = checkoutPaid + couponApplied;
        const completed = paid + couponApplied >= total;
        requestPhase = "update customer checkout status";
        await tx.update(checkouts).set({ subtotalAmount: decimal(bill.gross), discountAmount: decimal(bill.discount), totalAmount: decimal(total), paidAmount: decimal(nextPaid), status: completed ? "PAID" : "PARTIALLY_PAID", completedAt: completed ? sql`CURRENT_TIMESTAMP` : null }).where(eq(checkouts.checkoutId, checkoutId));
        if (completed) {
          if (checkoutIds.length > 1) await tx.update(checkouts).set({ status: "PAID", completedAt: sql`CURRENT_TIMESTAMP` }).where(inArray(checkouts.checkoutId, checkoutIds));
          const orderIds = await tx.select({ orderId: orders.orderId }).from(orders).where(inArray(orders.sessionId, bill.sessionIds));
          if (orderIds.length) await tx.update(orders).set({ status: "COMPLETED" }).where(inArray(orders.orderId, orderIds.map(order => order.orderId)));
          await tx.update(tableSessions).set({ status: "CLOSED", closedAt: sql`CURRENT_TIMESTAMP`, closedByStaffId: processedByStaffId }).where(inArray(tableSessions.sessionId, bill.sessionIds));
        }
        return { completed, change: couponOverage.cashChange, forfeited: couponOverage.forfeited, tendered: couponTendered, applied: couponApplied, tableId };
      }
      const isOther = action === "PAY_OTHER";
      requestPhase = isOther ? "load configured other payment method" : "load payment method";
      if (!isOther && (action !== "PAY" || typeof body.methodCode !== "string" || !paymentCodes.has(body.methodCode as PaymentCode))) throw new CheckoutError("결제 요청을 확인해 주세요.", 400);
      const methodCode = body.methodCode as PaymentCode;
      if (!isOther && methodCode !== "CARD" && methodCode !== "CASH") throw new CheckoutError("기타결제창에서 결제수단을 선택해 주세요.", 400);
      const otherMethodId = Number(body.paymentMethodId);
      const inputValue = Number(body.inputValue);
      if (isOther && (!Number.isSafeInteger(otherMethodId) || otherMethodId <= 0 || !Number.isSafeInteger(inputValue) || inputValue <= 0)) throw new CheckoutError("기타결제 입력값을 확인해 주세요.", 400);
      const [configured] = isOther ? await tx.select({ id: paymentMethods.paymentMethodId, type: paymentMethods.methodType, name: paymentMethods.methodName, inputType: paymentMethodSettings.inputType, unitAmount: paymentMethodSettings.unitAmount, balancePolicy: paymentMethodSettings.balancePolicy, cashChangeEnabled: paymentMethodSettings.cashChangeEnabled, cashChangeMinPercent: paymentMethodSettings.cashChangeMinPercent })
        .from(paymentMethods).innerJoin(paymentMethodSettings, eq(paymentMethods.paymentMethodId, paymentMethodSettings.paymentMethodId))
        .where(and(eq(paymentMethods.paymentMethodId, otherMethodId), eq(paymentMethods.isActive, 1),
          sql`${paymentMethods.methodCode} NOT IN ('CARD','CASH')`,
          sql`(${paymentMethodSettings.validityEnabled} = 0 OR (${paymentMethodSettings.validFrom} <= CURRENT_DATE() AND ${paymentMethodSettings.validUntil} >= CURRENT_DATE()))`))
        .for("update").limit(1) : [];
      const [legacy] = !isOther ? await tx.select({ id: paymentMethods.paymentMethodId, type: paymentMethods.methodType, name: paymentMethods.methodName }).from(paymentMethods).where(and(eq(paymentMethods.methodCode, methodCode), eq(paymentMethods.isActive, 1))).limit(1) : [];
      const method = isOther ? configured : legacy;
      if (!method) throw new CheckoutError("사용할 수 없는 결제수단입니다.", 409);
      const checkout = await activeCheckout(tx, bill.items.map(item => item.orderItemId));
      const checkoutIds = await activeCheckoutIds(tx, bill.items.map(item => item.orderItemId));
      const paid = won((await paymentStateForCheckouts(tx, checkoutIds)).reduce((sum, row) => sum + row.appliedAmount, 0));
      const checkoutPaid = checkout ? won((await paymentState(tx, checkout.checkoutId)).reduce((sum, row) => sum + row.appliedAmount, 0)) : 0;
      const total = Math.max(0, bill.gross - bill.discount); const remaining = Math.max(0, total - paid);
      const customerId = body.customerId === undefined || body.customerId === null ? null : Number(body.customerId);
      if (customerId !== null) {
        if (!Number.isSafeInteger(customerId) || customerId <= 0) throw new CheckoutError("\uACE0\uAC1D \uC815\uBCF4\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694.", 400);
        const [customer] = await tx.select({ customerId: customers.customerId })
          .from(customers)
          .where(and(eq(customers.customerId, customerId), eq(customers.isActive, 1), eq(customers.isPaymentManaged, 1)))
          .for("update")
          .limit(1);
        if (!customer) throw new CheckoutError("\uACB0\uC81C\uAD00\uB9AC \uC0AC\uC6A9 \uC911\uC778 \uACE0\uAC1D\uB9CC \uC120\uBD88\uAE08\uC744 \uC801\uB9BD\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.", 409);
      }
      if (!remaining) throw new CheckoutError("이미 결제가 완료되었습니다.");
      requestPhase = "validate amount and cash change threshold";
      const entered = Number(body.amount);
      const quantity = configured?.inputType === "QUANTITY" ? inputValue : null;
      const unitAmount = configured?.inputType === "QUANTITY" ? Number(configured.unitAmount) : null;
      if (quantity !== null && (!Number.isSafeInteger(unitAmount) || !unitAmount || unitAmount <= 0)) throw new CheckoutError("쿠폰 단가 설정을 확인해 주세요.", 409);
      const tendered = isOther ? (quantity !== null ? quantity * unitAmount! : inputValue) : Number.isSafeInteger(entered) && entered > 0 ? entered : remaining;
      if (!Number.isSafeInteger(tendered) || tendered <= 0 || tendered > 999999999999) throw new CheckoutError("결제 입력값이 너무 큽니다.", 400);
      if (isOther && configured?.inputType === "QUANTITY" && !configured.balancePolicy) throw new CheckoutError("잔액 처리 설정을 확인해 주세요.", 409);
      const isCard = !isOther && method.type === "CARD";
      const overpayment = tendered > remaining;
      const overpaymentConfirmed = body.prepaidOverpaymentConfirmed === true;
      if (isCard && overpayment && !customerId) throw new CheckoutError("\uCE74\uB4DC \uACB0\uC81C\uAE08\uC561\uC774 \uBC1B\uC744\uAE08\uC561\uBCF4\uB2E4 \uB9CE\uC2B5\uB2C8\uB2E4.");
      if (isCard && overpayment && !overpaymentConfirmed) throw new CheckoutError("\uCD08\uACFC \uCE74\uB4DC\uAE08\uC561\uC758 \uC120\uBD88 \uC801\uB9BD \uD655\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.");
      if (isOther && quantity === null && overpayment && !customerId && configured?.cashChangeEnabled !== 1) throw new CheckoutError("\uBC1B\uC744 \uAE08\uC561\uBCF4\uB2E4 \uB9CE\uC740 \uAE08\uC561\uC740 \uD574\uB2F9 \uACB0\uC81C\uC218\uB2E8\uC73C\uB85C \uCC98\uB9AC\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
      if (!isOther && method.type !== "CASH" && !isCard && overpayment) throw new CheckoutError("\uBC1B\uC744 \uAE08\uC561\uBCF4\uB2E4 \uB9CE\uC740 \uAE08\uC561\uC740 \uD574\uB2F9 \uACB0\uC81C\uC218\uB2E8\uC73C\uB85C \uCC98\uB9AC\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
      const applied = isOther || method.type === "CASH" || isCard ? Math.min(tendered, remaining) : tendered;
      // A method with an explicit cash-change rule must use that rule for overpayment;
      // the prepaid-credit confirmation is reserved for methods without cash change.
      const prepaidCredit = overpayment && customerId !== null && overpaymentConfirmed && configured?.cashChangeEnabled !== 1 ? tendered - applied : 0;
      const customerOverpaymentWithoutCredit = overpayment && customerId !== null && !overpaymentConfirmed;
      let otherChange = 0;
      let forfeited = 0;
      if (isOther && configured && overpayment && prepaidCredit === 0) {
        const overage = resolveQuantityOverage({ tenderedAmount: tendered, appliedAmount: applied, balancePolicy: configured.balancePolicy, cashChangeEnabled: configured.cashChangeEnabled, cashChangeMinPercent: configured.cashChangeMinPercent, prepaidCredit, customerId, customerOverpaymentWithoutCredit });
        if (overage.error === "THRESHOLD_MISSING") throw new CheckoutError("현금 거스름 가능 기준 설정을 확인해 주세요.", 409);
        if (overage.error === "THRESHOLD_NOT_MET") throw new CheckoutError(`${configured.cashChangeMinPercent}% 이상 사용 시 현금 거스름 가능`, 409);
        if (overage.error === "CHANGE_DISABLED") throw new CheckoutError("이 결제수단은 현금 거스름을 사용할 수 없습니다.", 409);
        otherChange = overage.cashChange;
        forfeited = overage.forfeited;
      }
      let checkoutId = checkout?.checkoutId;
      requestPhase = "create or update checkout rows";
      if (!checkoutId) {
        const [created] = await tx.insert(checkouts).values({ subtotalAmount: decimal(bill.gross), discountAmount: decimal(bill.discount), totalAmount: decimal(total), paidAmount: "0.00", status: "OPEN", createdByStaffId: processedByStaffId }).$returningId();
        checkoutId = created.checkoutId;
        if (bill.items.length) await tx.insert(checkoutItems).values(bill.items.map(item => ({ checkoutId: checkoutId!, orderItemId: item.orderItemId, qty: item.effectiveQty, unitPrice: item.unitPrice, discountAmount: "0.00", amount: decimal(item.effectiveQty * Number(item.unitPrice)) })));
      } else {
        // A new order can be added after a partial payment. Keep its receipt item
        // linked to the existing checkout when the bill amount is updated below.
        const linkedItems = await tx.select({ orderItemId: checkoutItems.orderItemId })
          .from(checkoutItems).where(eq(checkoutItems.checkoutId, checkoutId)).for("update");
        const linkedIds = new Set(linkedItems.map(item => item.orderItemId));
        const addedItems = bill.items.filter(item => !linkedIds.has(item.orderItemId));
        if (addedItems.length) await tx.insert(checkoutItems).values(addedItems.map(item => ({ checkoutId: checkoutId!, orderItemId: item.orderItemId, qty: item.effectiveQty, unitPrice: item.unitPrice, discountAmount: "0.00", amount: decimal(item.effectiveQty * Number(item.unitPrice)) })));
      }
      const change = !isOther && method.type === "CASH" && prepaidCredit === 0 ? Math.max(0, tendered - applied) : 0;
      const label = body.otherLabel === "식권" ? "식권" : undefined;
      const cardResult = !isOther && method.type === "CARD" ? await captureCardPayment() : null;
      const recordedAmount = isCard || prepaidCredit > 0 || customerOverpaymentWithoutCredit ? tendered : applied;
      requestPhase = "insert payment row";
      const [createdPayment] = await tx.insert(payments).values({ checkoutId, paymentMethodId: method.id, amount: decimal(recordedAmount), appliedAmount: decimal(applied), customerId, status: "APPROVED", approvalNo: cardResult?.approvalNo ?? null, externalTransactionId: cardResult?.externalTransactionId ?? null, processedByStaffId, note: !isOther && method.type === "CASH" && overpayment ? `현금 수령 ${tendered}원 / 거스름돈 ${change}원` : cardResult ? "DEV/MOCK: VAN 단말 연동 전 수기 카드 처리" : isOther ? null : label }).$returningId();
      await savePaymentSessionAllocations(tx, createdPayment.paymentId, bill, applied);
      if (prepaidCredit > 0 && customerId !== null) await tx.insert(customerPrepaidLedger).values({
        customerId,
        paymentId: createdPayment.paymentId,
        entryType: isCard ? "CARD_OVERPAYMENT" : "PAYMENT_OVERPAYMENT",
        amount: decimal(prepaidCredit),
        reversesLedgerId: null,
        createdByStaffId: processedByStaffId,
      });
      if (isOther && configured) {
        requestPhase = "insert other-payment details";
        await tx.insert(paymentOtherDetails).values({
        paymentId: createdPayment.paymentId, methodNameSnapshot: method.name,
        inputTypeSnapshot: configured.inputType, quantity,
        unitAmountSnapshot: quantity !== null ? unitAmount!.toFixed(2) : null,
        submittedAmount: decimal(tendered), appliedAmount: decimal(applied),
        balancePolicySnapshot: quantity !== null ? (otherChange > 0 ? "CASH_CHANGE" : prepaidCredit > 0 ? null : configured.balancePolicy) : null,
        cashChangeEnabledSnapshot: configured.cashChangeEnabled,
        cashChangeMinPercentSnapshot: configured.cashChangeEnabled === 1 ? configured.cashChangeMinPercent : null,
        cashChangeAmount: decimal(otherChange), forfeitedAmount: decimal(forfeited),
        });
      }
      const nextPaid = checkoutPaid + applied;
      requestPhase = "update checkout applied total";
      await tx.update(checkouts).set({ subtotalAmount: decimal(bill.gross), discountAmount: decimal(bill.discount), totalAmount: decimal(total), paidAmount: decimal(nextPaid), status: "PARTIALLY_PAID", completedAt: null }).where(eq(checkouts.checkoutId, checkoutId));
      return { completed: false, change, tendered, applied, prepaidCredit, tableId };
    });
    requestPhase = "refresh checkout snapshot after payment";
    const state = result.completed ? null : await snapshot(tableId);
    requestPhase = "load payment history after payment";
    const history = state?.checkoutIds.length ? await db.transaction(tx => paymentStateForCheckouts(tx, state.checkoutIds)) : [];
    return Response.json({ success: true, ...result, state: state && { gross: state.bill.gross, discounts: state.bill.discounts, total: Math.max(0, state.bill.gross - state.bill.discount), paid: state.paid, remaining: state.remaining, prepaidCredit: state.prepaidCredit, checkoutId: state.checkoutId, payments: history, isPartyBill: state.bill.isPartyBill, tableNos: state.bill.tableNos } });
  } catch (error) {
    console.error(`[POST /api/checkouts] failed during ${requestPhase}`, error);
    const knownError = error instanceof CheckoutError;
    const e = knownError ? error : new CheckoutError("결제를 처리할 수 없습니다.", 500);
    const debugMessage = !knownError && process.env.NODE_ENV !== "production"
      ? error instanceof Error ? error.message : String(error)
      : undefined;
    return Response.json({ success: false, message: e.message, ...(debugMessage ? { debugPhase: requestPhase, debugMessage } : {}) }, { status: e.status });
  }
}
