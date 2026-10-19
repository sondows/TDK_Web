import { and, eq, inArray, sql } from "drizzle-orm";
import { cashOpeningFunds, checkoutItems, checkouts, customerPrepaidLedger, dailyClosingSnapshots, diningTables, orderItems, orders, paymentMethods, paymentOtherDetails, paymentSessionAllocations, payments, tableSessions } from "@/db/schema";
import { expectedBusinessCash } from "@/lib/business-cash";
import type { BusinessTx } from "@/lib/business-session";
import { OPENING_CASH_ENABLED_KEY } from "@/lib/business-session";
import { systemSettings } from "@/db/schema";
import { summarizeSalesFinancials } from "@/lib/sales-financial-summary";

const amount = (value: string | number | null | undefined) => Number(value ?? 0);

/** A read-only calculation. The POST route repeats it inside its write transaction. */
export async function dailyClosingPreview(tx: BusinessTx, date: string) {
  const [setting] = await tx.select({ value: systemSettings.settingValue }).from(systemSettings)
    .where(eq(systemSettings.settingKey, OPENING_CASH_ENABLED_KEY)).limit(1);
  const openingCashEnabled = setting?.value === "1";
  const [fund] = await tx.select({ total: cashOpeningFunds.totalAmount }).from(cashOpeningFunds)
    .where(eq(cashOpeningFunds.businessDate, date)).limit(1);
  const [previous] = await tx.select({ count: sql<number>`COUNT(*)` }).from(dailyClosingSnapshots)
    .where(eq(dailyClosingSnapshots.salesDate, date));

  // Any currently open order can cross midnight and affect the cash position; do not close around it.
  const active = await tx.select({ id: tableSessions.sessionId, kind: tableSessions.sessionKind, name: tableSessions.displayName, tableNo: diningTables.tableNo })
    .from(tableSessions).leftJoin(diningTables, eq(diningTables.tableId, tableSessions.tableId))
    .where(eq(tableSessions.status, "OPEN"));
  const blockers = active.map(row => ({ sessionId: row.id, label: row.kind === "DINE_IN" ? `${row.tableNo ?? row.id}번 테이블` : row.name ?? "포장", reason: row.kind === "DINE_IN" ? "테이블 진행 중" : "포장 진행 중" }));
  if (openingCashEnabled && !fund) blockers.push({ sessionId: 0, label: "오늘의 시작 준비금", reason: "미등록" });
  const unfinished = await tx.select({ id: checkouts.checkoutId, status: checkouts.status }).from(checkouts)
    .where(sql`${checkouts.status} IN ('OPEN', 'PARTIALLY_PAID') AND (${checkouts.totalAmount} > 0 OR EXISTS (SELECT 1 FROM payments p WHERE p.checkout_id = ${checkouts.checkoutId} AND p.status IN ('APPROVED','PENDING')))`);
  for (const row of unfinished) blockers.push({ sessionId: row.id, label: `결제 #${row.id}`, reason: row.status === "PARTIALLY_PAID" ? "부분결제 중" : "결제 처리 중" });

  const saleRows = await tx.select({ id: checkouts.checkoutId, total: checkouts.totalAmount, discount: checkouts.discountAmount })
    .from(checkouts).where(sql`${checkouts.completedAt} >= ${`${date} 00:00:00`} AND ${checkouts.completedAt} < DATE_ADD(${date}, INTERVAL 1 DAY)`);
  const checkoutIds = saleRows.map(row => row.id);
  const paymentRows = checkoutIds.length ? await tx.select({
    paymentId: payments.paymentId, checkoutId: payments.checkoutId, appliedAmount: payments.appliedAmount,
    methodType: paymentMethods.methodType, methodCode: paymentMethods.methodCode, status: payments.status,
    cancelledAt: sql<string | null>`DATE_FORMAT(${payments.cancelledAt}, '%Y-%m-%d')`,
  }).from(payments).innerJoin(paymentMethods, eq(paymentMethods.paymentMethodId, payments.paymentMethodId))
    .where(inArray(payments.checkoutId, checkoutIds)) : [];
  const financials = summarizeSalesFinancials(saleRows, paymentRows, date, date);
  const approved = paymentRows.filter(row => row.status === "APPROVED" && amount(row.appliedAmount) > 0);
  const soldIds = new Set(approved.map(row => row.checkoutId));
  const customerPayments = approved.filter(row => row.methodCode === "CUSTOMER_PAYMENT");
  const customerPaymentAmount = customerPayments.reduce((sum, row) => sum + amount(row.appliedAmount), 0);

  const allocationRows = checkoutIds.length ? await tx.select({ checkoutId: payments.checkoutId, paymentId: payments.paymentId, kind: tableSessions.sessionKind, applied: paymentSessionAllocations.appliedAmount })
    .from(paymentSessionAllocations).innerJoin(payments, eq(payments.paymentId, paymentSessionAllocations.paymentId))
    .innerJoin(tableSessions, eq(tableSessions.sessionId, paymentSessionAllocations.sessionId))
    .where(inArray(payments.checkoutId, checkoutIds)) : [];
  const itemKinds = checkoutIds.length ? await tx.select({ checkoutId: checkoutItems.checkoutId, kind: tableSessions.sessionKind })
    .from(checkoutItems).innerJoin(orderItems, eq(orderItems.orderItemId, checkoutItems.orderItemId))
    .innerJoin(orders, eq(orders.orderId, orderItems.orderId))
    .innerJoin(tableSessions, eq(tableSessions.sessionId, orders.sessionId))
    .where(inArray(checkoutItems.checkoutId, checkoutIds)) : [];
  const kindsByCheckout = new Map<number, Set<string>>();
  for (const row of [...itemKinds, ...allocationRows]) {
    const kinds = kindsByCheckout.get(row.checkoutId) ?? new Set<string>();
    kinds.add(row.kind);
    kindsByCheckout.set(row.checkoutId, kinds);
  }
  const approvedById = new Map(approved.map(row => [row.paymentId, row]));
  const allocatedByPayment = new Map<number, number>();
  let dineAmount = 0, takeoutAmount = 0;
  for (const row of allocationRows) {
    if (!approvedById.has(row.paymentId)) continue;
    const applied = amount(row.applied);
    allocatedByPayment.set(row.paymentId, (allocatedByPayment.get(row.paymentId) ?? 0) + applied);
    if (row.kind === "DINE_IN") dineAmount += applied; else takeoutAmount += applied;
  }
  for (const payment of approved) if (!allocatedByPayment.has(payment.paymentId)) {
    const kinds = kindsByCheckout.get(payment.checkoutId);
    if (kinds?.size === 1) {
      if (kinds.has("DINE_IN")) dineAmount += amount(payment.appliedAmount);
      else takeoutAmount += amount(payment.appliedAmount);
    }
  }
  const dineCount = [...soldIds].filter(id => kindsByCheckout.get(id)?.has("DINE_IN")).length;
  const takeoutCount = [...soldIds].filter(id => [...(kindsByCheckout.get(id) ?? [])].some(kind => kind !== "DINE_IN")).length;

  // Physical cash follows payment/ledger timestamps, including refunds of older sales.
  const cashRows = await tx.select({ status: payments.status, value: payments.amount, paidAt: sql<string>`DATE_FORMAT(${payments.paidAt}, '%Y-%m-%d')`, cancelledAt: sql<string | null>`DATE_FORMAT(${payments.cancelledAt}, '%Y-%m-%d')` })
    .from(payments).innerJoin(paymentMethods, eq(paymentMethods.paymentMethodId, payments.paymentMethodId))
    .where(and(eq(paymentMethods.methodType, "CASH"), sql`(DATE(${payments.paidAt}) = ${date} OR DATE(${payments.cancelledAt}) = ${date})`));
  let cashReceived = 0, cashReturned = 0;
  for (const row of cashRows) {
    if (row.paidAt === date && ["APPROVED", "CANCELLED", "REFUNDED"].includes(row.status)) cashReceived += amount(row.value);
    if (row.cancelledAt === date && ["CANCELLED", "REFUNDED"].includes(row.status)) cashReturned += amount(row.value);
  }
  const ledgerCash = await tx.select({ value: customerPrepaidLedger.amount }).from(customerPrepaidLedger)
    .where(and(eq(customerPrepaidLedger.methodCode, "CASH"), sql`${customerPrepaidLedger.paymentId} IS NULL AND ${customerPrepaidLedger.entryType} IN ('DEPOSIT','REFUND') AND DATE(${customerPrepaidLedger.transactionAt}) = ${date}`));
  const cashLedgerMovement = ledgerCash.reduce((sum, row) => sum + amount(row.value), 0);
  const otherChange = await tx.select({ value: paymentOtherDetails.cashChangeAmount }).from(paymentOtherDetails)
    .innerJoin(payments, eq(payments.paymentId, paymentOtherDetails.paymentId))
    .where(sql`DATE(${payments.paidAt}) = ${date} AND ${payments.status} IN ('APPROVED','CANCELLED','REFUNDED')`);
  const otherCashChange = otherChange.reduce((sum, row) => sum + amount(row.value), 0);
  const [refunds] = await tx.select({ count: sql<number>`COUNT(*)`, value: sql<string>`COALESCE(SUM(${payments.appliedAmount}), 0)` }).from(payments)
    .where(and(sql`${payments.status} IN ('CANCELLED','REFUNDED')`, sql`DATE(${payments.cancelledAt}) = ${date}`));
  const openingCash = openingCashEnabled ? amount(fund?.total) : null;
  const expectedCash = openingCashEnabled && fund
    ? expectedBusinessCash(openingCash!, cashReceived, cashReturned, cashLedgerMovement, otherCashChange) : null;
  return {
    businessDate: date, openedAt: `${date}T00:00:00+09:00`, previousClosingCount: Number(previous.count),
    openingCashEnabled, openingCash, expectedCash, blockers,
    totalSales: financials.netSales, saleCount: financials.transactionCount,
    discountAmount: saleRows.filter(row => soldIds.has(row.id)).reduce((sum, row) => sum + amount(row.discount), 0),
    discountCount: saleRows.filter(row => soldIds.has(row.id) && amount(row.discount) > 0).length,
    cardAmount: financials.cardAmount, cardCount: financials.cardCount,
    cashAmount: financials.cashAmount, cashCount: financials.cashCount,
    otherAmount: financials.otherAmount - customerPaymentAmount, otherCount: approved.filter(row => row.methodType !== "CARD" && row.methodType !== "CASH" && row.methodCode !== "CUSTOMER_PAYMENT").length,
    customerPaymentAmount, customerPaymentCount: customerPayments.length,
    bankTransferAmount: financials.bankTransferAmount,
    cancellationCount: Number(refunds.count), refundAmount: amount(refunds.value),
    dineCount, dineAmount, takeoutCount, takeoutAmount,
    cashReceived, cashReturned, cashLedgerMovement, otherCashChange,
  };
}
