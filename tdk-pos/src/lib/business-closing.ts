import { and, eq, inArray, sql } from "drizzle-orm";
import { businessSessions, checkoutItems, checkouts, customerPrepaidLedger, diningTables, orderItems, orders, paymentMethods, paymentOtherDetails, paymentSessionAllocations, payments, tableSessions } from "@/db/schema";
import { summarizeSalesFinancials } from "@/lib/sales-financial-summary";
import type { BusinessTx } from "@/lib/business-session";
import { expectedBusinessCash } from "@/lib/business-cash";

const amount = (value: string | number | null | undefined) => Number(value ?? 0);

export async function closingPreview(tx: BusinessTx, businessSessionId: number) {
  const [business] = await tx.select({
    businessSessionId: businessSessions.businessSessionId, businessDate: businessSessions.businessDate,
    status: businessSessions.status, openedAt: businessSessions.openedAt,
    openedAtLocal: sql<string>`DATE_FORMAT(${businessSessions.openedAt}, '%Y-%m-%dT%H:%i:%s')`,
    openingCashEnabled: businessSessions.openingCashEnabled, openingCash: businessSessions.openingCash,
  }).from(businessSessions)
    .where(eq(businessSessions.businessSessionId, businessSessionId)).limit(1);
  if (!business || business.status !== "OPEN") return null;

  const [previousClosings] = await tx.select({ count: sql<number>`COUNT(*)` }).from(businessSessions)
    .where(and(eq(businessSessions.businessDate, business.businessDate), eq(businessSessions.status, "CLOSED")));

  const active = await tx.select({ sessionId: tableSessions.sessionId, kind: tableSessions.sessionKind, name: tableSessions.displayName, tableNo: diningTables.tableNo })
    .from(tableSessions).leftJoin(diningTables, eq(diningTables.tableId, tableSessions.tableId))
    .where(eq(tableSessions.status, "OPEN")).for("update");
  const blockers = active.map(row => ({ sessionId: row.sessionId, label: row.kind === "DINE_IN" ? `${row.tableNo ?? row.sessionId}번 테이블` : row.name ?? "포장", reason: row.kind === "DINE_IN" ? "테이블 진행 중" : "포장 진행 중" }));
  // A table may have been manually closed while its order still has unsold items.
  const unfinishedItems = await tx.select({ sessionId: tableSessions.sessionId, kind: tableSessions.sessionKind, name: tableSessions.displayName, tableNo: diningTables.tableNo })
    .from(orderItems).innerJoin(orders, eq(orders.orderId, orderItems.orderId))
    .innerJoin(tableSessions, eq(tableSessions.sessionId, orders.sessionId))
    .leftJoin(diningTables, eq(diningTables.tableId, tableSessions.tableId))
    .where(and(eq(tableSessions.businessSessionId, businessSessionId), sql`${orders.status} <> 'CANCELLED'`,
      sql`${orderItems.status} <> 'CANCELLED' AND ${orderItems.itemType} <> 'COMPONENT'`,
      sql`${orderItems.qty} > COALESCE((SELECT SUM(cancelled_qty) FROM order_item_cancellations WHERE order_item_id = ${orderItems.orderItemId}), 0)`,
      sql`NOT EXISTS (SELECT 1 FROM checkout_items ci JOIN checkouts c ON c.checkout_id = ci.checkout_id WHERE ci.order_item_id = ${orderItems.orderItemId} AND c.status = 'PAID')`));
  for (const row of unfinishedItems) if (!blockers.some(blocker => blocker.sessionId === row.sessionId))
    blockers.push({ sessionId: row.sessionId, label: row.kind === "DINE_IN" ? `${row.tableNo ?? row.sessionId}번 테이블` : row.name ?? "포장", reason: "미완료 주문" });

  const linkedItems = await tx.select({ checkoutId: checkouts.checkoutId, status: checkouts.status, kind: tableSessions.sessionKind })
    .from(checkoutItems).innerJoin(checkouts, eq(checkouts.checkoutId, checkoutItems.checkoutId))
    .innerJoin(orderItems, eq(orderItems.orderItemId, checkoutItems.orderItemId))
    .innerJoin(orders, eq(orders.orderId, orderItems.orderId))
    .innerJoin(tableSessions, eq(tableSessions.sessionId, orders.sessionId))
    .where(eq(tableSessions.businessSessionId, businessSessionId));
  const linkedAllocations = await tx.select({ checkoutId: checkouts.checkoutId, status: checkouts.status, kind: tableSessions.sessionKind,
    paymentStatus: payments.status, appliedAmount: paymentSessionAllocations.appliedAmount })
    .from(paymentSessionAllocations).innerJoin(payments, eq(payments.paymentId, paymentSessionAllocations.paymentId))
    .innerJoin(checkouts, eq(checkouts.checkoutId, payments.checkoutId))
    .innerJoin(tableSessions, eq(tableSessions.sessionId, paymentSessionAllocations.sessionId))
    .where(eq(tableSessions.businessSessionId, businessSessionId));
  const linked = [...linkedItems, ...linkedAllocations];
  const checkoutIds = [...new Set(linked.map(row => row.checkoutId))];
  const checkoutRows = checkoutIds.length ? await tx.select({ id: checkouts.checkoutId, total: checkouts.totalAmount, discount: checkouts.discountAmount, status: checkouts.status })
    .from(checkouts).where(inArray(checkouts.checkoutId, checkoutIds)).for("update") : [];
  for (const checkout of checkoutRows) if (checkout.status === "OPEN" || checkout.status === "PARTIALLY_PAID")
    blockers.push({ sessionId: checkout.id, label: `결제 #${checkout.id}`, reason: checkout.status === "PARTIALLY_PAID" ? "부분결제 중" : "미결제" });
  const paymentRows = checkoutIds.length ? await tx.select({
    checkoutId: payments.checkoutId, appliedAmount: payments.appliedAmount, methodType: paymentMethods.methodType, methodCode: paymentMethods.methodCode,
    status: payments.status, cancelledAt: sql<string | null>`DATE_FORMAT(${payments.cancelledAt}, '%Y-%m-%d')`,
  }).from(payments).innerJoin(paymentMethods, eq(paymentMethods.paymentMethodId, payments.paymentMethodId))
    .where(inArray(payments.checkoutId, checkoutIds)).for("update") : [];
  for (const payment of paymentRows) if (payment.status === "PENDING")
    blockers.push({ sessionId: payment.checkoutId, label: `결제 #${payment.checkoutId}`, reason: "결제 처리 중" });

  const financials = summarizeSalesFinancials(checkoutRows.map(row => ({ id: row.id, total: row.total, discount: row.discount })),
    paymentRows, "0000-01-01", "9999-12-31");
  const customerPaymentAmount = paymentRows.filter(row => row.status === "APPROVED" && row.methodCode === "CUSTOMER_PAYMENT")
    .reduce((sum, row) => sum + amount(row.appliedAmount), 0);
  const soldCheckoutIds = new Set(paymentRows.filter(row => row.status === "APPROVED" && amount(row.appliedAmount) > 0).map(row => row.checkoutId));
  const discountCount = checkoutRows.filter(row => soldCheckoutIds.has(row.id) && amount(row.discount) > 0).length;
  const usedPayments = paymentRows.filter(row => row.status === "APPROVED" && amount(row.appliedAmount) > 0);
  const cardCount = usedPayments.filter(row => row.methodType === "CARD").length;
  const cashCount = usedPayments.filter(row => row.methodType === "CASH").length;
  const customerPaymentCount = usedPayments.filter(row => row.methodCode === "CUSTOMER_PAYMENT").length;
  const otherCount = usedPayments.filter(row => row.methodType !== "CARD" && row.methodType !== "CASH" && row.methodCode !== "CUSTOMER_PAYMENT").length;
  const approvedAllocations = linkedAllocations.filter(row => row.paymentStatus === "APPROVED" && amount(row.appliedAmount) > 0);
  const dineAmount = approvedAllocations.filter(row => row.kind === "DINE_IN").reduce((sum, row) => sum + amount(row.appliedAmount), 0);
  const takeoutAmount = approvedAllocations.filter(row => row.kind !== "DINE_IN").reduce((sum, row) => sum + amount(row.appliedAmount), 0);
  const dineCount = new Set(linked.filter(row => row.kind === "DINE_IN" && soldCheckoutIds.has(row.checkoutId)).map(row => row.checkoutId)).size;
  const takeoutCount = new Set(linked.filter(row => row.kind !== "DINE_IN" && soldCheckoutIds.has(row.checkoutId)).map(row => row.checkoutId)).size;

  // Physical cash flow is timestamp-based: include money received and later returned, even for a sale from an earlier session.
  const cashRows = await tx.select({ status: payments.status, amount: payments.amount, paidAt: payments.paidAt, cancelledAt: payments.cancelledAt })
    .from(payments).innerJoin(paymentMethods, eq(paymentMethods.paymentMethodId, payments.paymentMethodId))
    .where(and(eq(paymentMethods.methodType, "CASH"), sql`((${payments.paidAt} >= (SELECT opened_at FROM business_sessions WHERE business_session_id = ${businessSessionId}) AND ${payments.paidAt} <= NOW()) OR (${payments.cancelledAt} >= (SELECT opened_at FROM business_sessions WHERE business_session_id = ${businessSessionId}) AND ${payments.cancelledAt} <= NOW()))`));
  let cashReceived = 0, cashReturned = 0;
  for (const row of cashRows) {
    if (row.paidAt >= business.openedAt && (row.status === "APPROVED" || row.status === "CANCELLED" || row.status === "REFUNDED")) cashReceived += amount(row.amount);
    if (row.cancelledAt && row.cancelledAt >= business.openedAt && (row.status === "CANCELLED" || row.status === "REFUNDED")) cashReturned += amount(row.amount);
  }
  const ledgerCash = await tx.select({ amount: customerPrepaidLedger.amount }).from(customerPrepaidLedger)
    .where(and(eq(customerPrepaidLedger.methodCode, "CASH"), sql`${customerPrepaidLedger.paymentId} IS NULL AND ${customerPrepaidLedger.entryType} IN ('DEPOSIT','REFUND') AND ${customerPrepaidLedger.transactionAt} >= (SELECT opened_at FROM business_sessions WHERE business_session_id = ${businessSessionId}) AND ${customerPrepaidLedger.transactionAt} <= NOW()`));
  const cashLedgerMovement = ledgerCash.reduce((sum, row) => sum + amount(row.amount), 0);
  const otherChangeRows = await tx.select({ change: paymentOtherDetails.cashChangeAmount })
    .from(paymentOtherDetails).innerJoin(payments, eq(payments.paymentId, paymentOtherDetails.paymentId))
    .where(sql`${payments.paidAt} >= (SELECT opened_at FROM business_sessions WHERE business_session_id = ${businessSessionId}) AND ${payments.paidAt} <= NOW() AND ${payments.status} IN ('APPROVED','CANCELLED','REFUNDED')`);
  const otherCashChange = otherChangeRows.reduce((sum, row) => sum + amount(row.change), 0);
  const expectedCash = business.openingCashEnabled ? expectedBusinessCash(amount(business.openingCash), cashReceived, cashReturned, cashLedgerMovement, otherCashChange) : null;
  const cancelledPayments = paymentRows.filter(row => row.status === "CANCELLED" || row.status === "REFUNDED");
  return {
    businessSessionId, businessDate: business.businessDate, openedAt: `${business.openedAtLocal}+09:00`,
    previousClosingCount: Number(previousClosings.count),
    openingCashEnabled: business.openingCashEnabled === 1, openingCash: business.openingCashEnabled ? amount(business.openingCash) : null,
    blockers,
    totalSales: financials.netSales, saleCount: financials.transactionCount,
    discountAmount: checkoutRows.filter(row => soldCheckoutIds.has(row.id)).reduce((sum, row) => sum + amount(row.discount), 0),
    discountCount, cardAmount: financials.cardAmount, cardCount, cashAmount: financials.cashAmount, cashCount,
    customerPaymentAmount, otherAmount: financials.otherAmount - customerPaymentAmount, bankTransferAmount: financials.bankTransferAmount,
    customerPaymentCount, otherCount,
    cancellationCount: cancelledPayments.length,
    refundAmount: cancelledPayments.reduce((sum, row) => sum + amount(row.appliedAmount), 0),
    dineCount, dineAmount, takeoutCount, takeoutAmount, cashReceived, cashReturned, cashLedgerMovement, otherCashChange, expectedCash,
  };
}
