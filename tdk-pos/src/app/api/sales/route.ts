import { eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  checkoutItems,
  checkouts,
  diningTables,
  orderItemCancellations,
  orderItems,
  orders,
  paymentMethods,
  payments,
  staff,
  tableSessionDiscounts,
  tableSessions,
} from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import type { SaleDetail, SaleDisplayStatus, SaleListItem } from "@/lib/sales-types";

const finishedStatuses = new Set(["PAID", "CANCELLED", "REFUNDED"]);
const includedPaymentStatuses = new Set(["APPROVED", "CANCELLED", "REFUNDED"]);
const won = (value: number | string) => Math.max(0, Math.floor(Number(value)));

const todayInKorea = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(value.getTime()) && value.toISOString().slice(0, 10) === date ? value : null;
}

function dateRange(startDate: string, endDate: string) {
  const startValue = validDate(startDate);
  const endValue = validDate(endDate);
  if (!startValue || !endValue || startDate > endDate) return null;
  const endExclusive = new Date(endValue.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { startDate, endDate, start: `${startDate} 00:00:00`, end: `${endExclusive} 00:00:00` };
}

function paymentLabel(payment: { methodCode: string; methodName: string; note: string | null }) {
  const labels: Record<string, string> = {
    CARD: "카드",
    CASH: "현금",
    TRANSFER: "이체",
    MEAL_TICKET: "후불식권",
    GIFT: "상품권",
    OTHER: payment.note === "식권" ? "식권" : "기타결재",
  };
  return labels[payment.methodCode] ?? payment.methodName;
}

function displayStatus(checkoutStatus: string, paymentRows: Array<{ status: string; amount: string }>): SaleDisplayStatus {
  if (!finishedStatuses.has(checkoutStatus)) return "IN_PROGRESS";
  if (checkoutStatus === "CANCELLED" || checkoutStatus === "REFUNDED") return "CANCELLED";
  const approved = paymentRows.filter((payment) => payment.status === "APPROVED").reduce((sum, payment) => sum + won(payment.amount), 0);
  const cancelled = paymentRows.filter((payment) => payment.status === "CANCELLED" || payment.status === "REFUNDED").reduce((sum, payment) => sum + won(payment.amount), 0);
  if (cancelled > 0 && approved === 0) return "CANCELLED";
  if (cancelled > 0) return "PARTIALLY_CANCELLED";
  return "COMPLETED";
}

async function ensurePosAccess() {
  const [currentStaff, loginMode] = await Promise.all([getCurrentStaff(), getPosLoginMode()]);
  return Boolean(currentStaff) || loginMode === "SHARED";
}

export async function GET(request: Request) {
  try {
    if (!(await ensurePosAccess())) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
    const url = new URL(request.url);
    const checkoutId = Number(url.searchParams.get("checkoutId"));
    if (Number.isInteger(checkoutId) && checkoutId > 0) return detailResponse(checkoutId);
    const legacyDate = url.searchParams.get("date");
    const startDate = url.searchParams.get("startDate") ?? legacyDate ?? todayInKorea();
    const endDate = url.searchParams.get("endDate") ?? legacyDate ?? startDate;
    return listResponse(startDate, endDate);
  } catch (error) {
    console.error("sales history query failed", error);
    return Response.json({ success: false, message: "판매내역을 불러올 수 없습니다." }, { status: 500 });
  }
}

async function listResponse(startDate: string, endDate: string) {
  const range = dateRange(startDate, endDate);
  if (!range) return Response.json({ success: false, message: "조회일을 확인해 주세요." }, { status: 400 });
  const occurredAt = sql`COALESCE(${checkouts.completedAt}, ${checkouts.createdAt})`;
  const paymentCheckoutRows = await db.select({ checkoutId: payments.checkoutId })
    .from(payments)
    .where(or(
      sql`${payments.paidAt} >= ${range.start} AND ${payments.paidAt} < ${range.end}`,
      sql`${payments.cancelledAt} >= ${range.start} AND ${payments.cancelledAt} < ${range.end}`,
    ));
  const paymentCheckoutIds = [...new Set(paymentCheckoutRows.map((payment) => payment.checkoutId))];
  const checkoutDateCondition = sql`${occurredAt} >= ${range.start} AND ${occurredAt} < ${range.end}`;
  const checkoutRows = await db.select({
    checkoutId: checkouts.checkoutId,
    status: checkouts.status,
    totalAmount: checkouts.totalAmount,
    createdAt: sql<string>`CONCAT(DATE_FORMAT(${checkouts.createdAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00')`,
    completedAt: sql<string | null>`CASE WHEN ${checkouts.completedAt} IS NULL THEN NULL ELSE CONCAT(DATE_FORMAT(${checkouts.completedAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00') END`,
  }).from(checkouts).where(paymentCheckoutIds.length
    ? or(checkoutDateCondition, inArray(checkouts.checkoutId, paymentCheckoutIds))
    : checkoutDateCondition);
  const checkoutIds = checkoutRows.map((checkout) => checkout.checkoutId);
  if (!checkoutIds.length) return Response.json({ success: true, date: startDate, startDate, endDate, summary: { netSales: 0, transactionCount: 0, cancellationCount: 0 }, sales: [] });

  const [transactionRows, paymentRows] = await Promise.all([
    db.select({
      checkoutId: checkoutItems.checkoutId,
      checkoutItemId: checkoutItems.checkoutItemId,
      tableNo: diningTables.tableNo,
      itemName: orderItems.itemName,
      orderedAt: sql<string>`CONCAT(DATE_FORMAT(${orders.orderedAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00')`,
    })
      .from(checkoutItems)
      .innerJoin(orderItems, eq(orderItems.orderItemId, checkoutItems.orderItemId))
      .innerJoin(orders, eq(orders.orderId, orderItems.orderId))
      .innerJoin(tableSessions, eq(tableSessions.sessionId, orders.sessionId))
      .innerJoin(diningTables, eq(diningTables.tableId, tableSessions.tableId))
      .where(inArray(checkoutItems.checkoutId, checkoutIds)),
    db.select({
      checkoutId: payments.checkoutId,
      status: payments.status,
      amount: payments.amount,
      paidAt: sql<string>`CONCAT(DATE_FORMAT(${payments.paidAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00')`,
      cancelledAt: sql<string | null>`CASE WHEN ${payments.cancelledAt} IS NULL THEN NULL ELSE CONCAT(DATE_FORMAT(${payments.cancelledAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00') END`,
      methodCode: paymentMethods.methodCode,
      methodName: paymentMethods.methodName,
      note: payments.note,
    }).from(payments)
      .innerJoin(paymentMethods, eq(paymentMethods.paymentMethodId, payments.paymentMethodId))
      .where(inArray(payments.checkoutId, checkoutIds)),
  ]);

  const transactionRowsByCheckout = new Map<number, typeof transactionRows>();
  transactionRows.forEach((row) => {
    transactionRowsByCheckout.set(row.checkoutId, [...(transactionRowsByCheckout.get(row.checkoutId) ?? []), row]);
  });
  const paymentsByCheckout = new Map<number, typeof paymentRows>();
  paymentRows.forEach((payment) => paymentsByCheckout.set(payment.checkoutId, [...(paymentsByCheckout.get(payment.checkoutId) ?? []), payment]));

  const sales = checkoutRows.flatMap((checkout): SaleListItem[] => {
    const transactionPayments = (paymentsByCheckout.get(checkout.checkoutId) ?? []).filter((payment) => includedPaymentStatuses.has(payment.status));
    const finished = finishedStatuses.has(checkout.status);
    if (!finished && transactionPayments.length === 0) return [];
    const checkoutTransactionRows = [...(transactionRowsByCheckout.get(checkout.checkoutId) ?? [])]
      .sort((a, b) => a.checkoutItemId - b.checkoutItemId);
    const tables = [...new Set(checkoutTransactionRows.map((row) => row.tableNo))]
      .sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
    const menuNames = [...new Set(checkoutTransactionRows.map((row) => row.itemName))];
    const firstOrderedAt = checkoutTransactionRows.reduce<string | null>((earliest, row) => !earliest || row.orderedAt < earliest ? row.orderedAt : earliest, null);
    const methods = [...new Set(transactionPayments.map(paymentLabel))];
    const latestPaymentAt = transactionPayments.reduce<string | null>((latest, payment) => !latest || payment.paidAt > latest ? payment.paidAt : latest, null);
    const transactionAt = [checkout.completedAt, latestPaymentAt, checkout.createdAt]
      .filter((value): value is string => value !== null)
      .reduce((latest, value) => value > latest ? value : latest);
    return [{
      checkoutId: checkout.checkoutId,
      occurredAt: transactionAt,
      orderedAt: firstOrderedAt ?? checkout.createdAt,
      tableLabel: tables.length ? tables.map((tableNo) => `${tableNo}T`).join("+") : "-",
      tableNos: tables,
      menuSummary: menuNames.length ? `${menuNames[0]}${menuNames.length > 1 ? ` 외 ${menuNames.length - 1}건` : ""}` : "-",
      totalAmount: won(checkout.totalAmount),
      paymentMethods: methods.length ? methods.join("+") : "-",
      status: displayStatus(checkout.status, transactionPayments),
    }];
  }).filter((sale) => sale.occurredAt.slice(0, 10) >= startDate && sale.occurredAt.slice(0, 10) <= endDate)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  const completedIds = new Set(sales.filter((sale) => sale.status !== "IN_PROGRESS").map((sale) => sale.checkoutId));
  const netSales = paymentRows.filter((payment) => completedIds.has(payment.checkoutId) && payment.status === "APPROVED").reduce((sum, payment) => sum + won(payment.amount), 0);
  const completedSales = sales.filter((sale) => sale.status !== "IN_PROGRESS");
  const cancelledCheckoutIds = new Set(paymentRows
    .filter((payment) => {
      const cancelledDate = payment.cancelledAt?.slice(0, 10);
      return (payment.status === "CANCELLED" || payment.status === "REFUNDED") && Boolean(cancelledDate && cancelledDate >= startDate && cancelledDate <= endDate);
    })
    .map((payment) => payment.checkoutId));
  return Response.json({
    success: true,
    date: startDate,
    startDate,
    endDate,
    summary: {
      netSales,
      transactionCount: completedSales.length,
      cancellationCount: cancelledCheckoutIds.size,
    },
    sales,
  });
}

async function detailResponse(checkoutId: number) {
  const [checkout] = await db.select({
    checkoutId: checkouts.checkoutId,
    status: checkouts.status,
    subtotalAmount: checkouts.subtotalAmount,
    discountAmount: checkouts.discountAmount,
    totalAmount: checkouts.totalAmount,
    createdAt: sql<string>`CONCAT(DATE_FORMAT(${checkouts.createdAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00')`,
    completedAt: sql<string | null>`CASE WHEN ${checkouts.completedAt} IS NULL THEN NULL ELSE CONCAT(DATE_FORMAT(${checkouts.completedAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00') END`,
  }).from(checkouts).where(eq(checkouts.checkoutId, checkoutId)).limit(1);
  if (!checkout) return Response.json({ success: false, message: "판매 거래를 찾을 수 없습니다." }, { status: 404 });

  const itemRows = await db.select({
    orderItemId: checkoutItems.orderItemId,
    itemName: orderItems.itemName,
    unitPrice: checkoutItems.unitPrice,
    qty: checkoutItems.qty,
    amount: checkoutItems.amount,
    sessionId: orders.sessionId,
    tableNo: diningTables.tableNo,
  }).from(checkoutItems)
    .innerJoin(orderItems, eq(orderItems.orderItemId, checkoutItems.orderItemId))
    .innerJoin(orders, eq(orders.orderId, orderItems.orderId))
    .innerJoin(tableSessions, eq(tableSessions.sessionId, orders.sessionId))
    .innerJoin(diningTables, eq(diningTables.tableId, tableSessions.tableId))
    .where(eq(checkoutItems.checkoutId, checkoutId));
  const sessionIds = [...new Set(itemRows.map((item) => item.sessionId))];
  const itemIds = [...new Set(itemRows.map((item) => item.orderItemId))];
  const [discountRows, paymentRows, cancellationRows] = await Promise.all([
    sessionIds.length ? db.select({ label: tableSessionDiscounts.label, amount: tableSessionDiscounts.discountAmount })
      .from(tableSessionDiscounts).where(inArray(tableSessionDiscounts.sessionId, sessionIds)) : [],
    db.select({
      paymentId: payments.paymentId,
      amount: payments.amount,
      status: payments.status,
      approvalNo: payments.approvalNo,
      paidAt: sql<string>`CONCAT(DATE_FORMAT(${payments.paidAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00')`,
      cancelledAt: sql<string | null>`CASE WHEN ${payments.cancelledAt} IS NULL THEN NULL ELSE CONCAT(DATE_FORMAT(${payments.cancelledAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00') END`,
      methodCode: paymentMethods.methodCode,
      methodName: paymentMethods.methodName,
      note: payments.note,
      staffName: staff.name,
    }).from(payments)
      .innerJoin(paymentMethods, eq(paymentMethods.paymentMethodId, payments.paymentMethodId))
      .leftJoin(staff, eq(staff.staffId, payments.processedByStaffId))
      .where(eq(payments.checkoutId, checkoutId)),
    itemIds.length ? db.select({
      cancellationId: orderItemCancellations.cancellationId,
      itemName: orderItems.itemName,
      qty: orderItemCancellations.cancelledQty,
      amount: orderItemCancellations.cancelledAmount,
      reason: orderItemCancellations.cancellationReason,
      cancelledAt: sql<string>`CONCAT(DATE_FORMAT(${orderItemCancellations.cancelledAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00')`,
    }).from(orderItemCancellations)
      .innerJoin(orderItems, eq(orderItems.orderItemId, orderItemCancellations.orderItemId))
      .where(inArray(orderItemCancellations.orderItemId, itemIds)) : [],
  ]);
  const relevantPayments = paymentRows.filter((payment) => includedPaymentStatuses.has(payment.status));
  const tables = [...new Set(itemRows.map((item) => item.tableNo))].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  const latestPaymentAt = relevantPayments.reduce<string | null>((latest, payment) => !latest || payment.paidAt > latest ? payment.paidAt : latest, null);
  const transactionAt = [checkout.completedAt, latestPaymentAt, checkout.createdAt]
    .filter((value): value is string => value !== null)
    .reduce((latest, value) => value > latest ? value : latest);
  const sale: SaleDetail = {
    checkoutId,
    occurredAt: transactionAt,
    tableLabel: tables.length ? `${tables.join("·")}T` : "-",
    checkoutStatus: checkout.status,
    displayStatus: displayStatus(checkout.status, relevantPayments),
    subtotalAmount: won(checkout.subtotalAmount),
    discountAmount: won(checkout.discountAmount),
    totalAmount: won(checkout.totalAmount),
    approvedAmount: relevantPayments.filter((payment) => payment.status === "APPROVED").reduce((sum, payment) => sum + won(payment.amount), 0),
    items: itemRows.map((item) => ({ orderItemId: item.orderItemId, itemName: item.itemName, unitPrice: won(item.unitPrice), qty: item.qty, amount: won(item.amount) })),
    discounts: discountRows.map((discount) => ({ label: discount.label, amount: won(discount.amount) })),
    payments: relevantPayments.map((payment) => ({
      paymentId: payment.paymentId,
      method: paymentLabel(payment),
      amount: won(payment.amount),
      status: payment.status,
      approvalNo: payment.approvalNo,
      paidAt: payment.paidAt,
      cancelledAt: payment.cancelledAt,
      staffName: payment.staffName,
    })),
    orderCancellations: cancellationRows.map((cancellation) => ({
      cancellationId: cancellation.cancellationId,
      itemName: cancellation.itemName,
      qty: cancellation.qty,
      amount: won(cancellation.amount),
      reason: cancellation.reason,
      cancelledAt: cancellation.cancelledAt,
    })),
  };
  return Response.json({ success: true, sale });
}
