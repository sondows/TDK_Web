import { desc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  checkoutItems,
  checkouts,
  customerPrepaidLedger,
  customers,
  diningTables,
  orderItemCancellations,
  orderItems,
  orders,
  paymentMethods,
  paymentOtherDetails,
  payments,
  staff,
  tableSessionDiscounts,
  tableSessions,
} from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { getReceiptLogoRaster } from "@/lib/receipt-logo-storage";
import { getStoreInfo } from "@/lib/store-info";
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

function paymentLabel(payment: { methodCode: string; methodName: string; methodNameSnapshot: string | null; quantity: number | null; note: string | null }) {
  if (payment.methodNameSnapshot) return `${payment.methodNameSnapshot}${payment.quantity ? ` × ${payment.quantity}매` : ""}`;
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

function displayStatus(checkoutStatus: string, paymentRows: Array<{ status: string; appliedAmount: string }>): SaleDisplayStatus {
  if (!finishedStatuses.has(checkoutStatus)) return "IN_PROGRESS";
  if (checkoutStatus === "CANCELLED" || checkoutStatus === "REFUNDED") return "CANCELLED";
  const approved = paymentRows.filter((payment) => payment.status === "APPROVED").reduce((sum, payment) => sum + won(payment.appliedAmount), 0);
  const cancelled = paymentRows.filter((payment) => payment.status === "CANCELLED" || payment.status === "REFUNDED").reduce((sum, payment) => sum + won(payment.appliedAmount), 0);
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
    if (!(await ensurePosAccess()) && !(await getCurrentAdminStaff())) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
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

// Reprints an existing completed checkout. This path only reads sales data and
// sends it to the local Device Agent; it never calls the checkout write API.
export async function POST(request: Request) {
  try {
    if (!(await ensurePosAccess())) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
    const body = await request.json() as { checkoutId?: unknown; tableId?: unknown };
    if (body.checkoutId !== undefined && body.tableId !== undefined)
      return Response.json({ success: false, message: "거래와 테이블을 동시에 지정할 수 없습니다." }, { status: 400 });
    let checkoutId = body.checkoutId;
    if (body.tableId !== undefined) {
      if (!Number.isSafeInteger(body.tableId) || Number(body.tableId) <= 0)
        return Response.json({ success: false, message: "테이블을 확인해 주세요." }, { status: 400 });
      const resolved = await latestCompletedCheckoutForTable(Number(body.tableId));
      if ("message" in resolved)
        return Response.json({ success: false, message: resolved.message }, { status: resolved.status });
      checkoutId = resolved.checkoutId;
    }
    if (!Number.isSafeInteger(checkoutId) || Number(checkoutId) <= 0)
      return Response.json({ success: false, message: "판매 거래를 확인해 주세요." }, { status: 400 });

    const sale = await loadSaleDetail(Number(checkoutId));
    if (!sale) return Response.json({ success: false, message: "판매 거래를 찾을 수 없습니다." }, { status: 404 });
    if (sale.checkoutStatus !== "PAID" || sale.displayStatus === "CANCELLED")
      return Response.json({ success: false, message: "완료된 유효 결제 거래만 출력할 수 있습니다." }, { status: 409 });

    // checkout_items records the effective quantity when the checkout is created.
    // Some older checkouts have later bill changes without matching checkout_items;
    // printing those rows would make the receipt disagree with the saved total.
    const itemAmount = sale.items.reduce((sum, item) => sum + item.amount, 0);
    if (!sale.items.length || sale.items.some(item => item.qty <= 0 || item.unitPrice * item.qty !== item.amount) ||
        itemAmount !== sale.subtotalAmount ||
        Math.max(0, sale.subtotalAmount - sale.discountAmount) !== sale.totalAmount)
      return Response.json({ success: false, message: "저장된 메뉴 내역과 거래 금액이 일치하지 않아 영수증을 출력할 수 없습니다." }, { status: 409 });

    const approvedPayments = sale.payments.filter(payment => payment.status === "APPROVED");
    const partialCancellation = sale.displayStatus === "PARTIALLY_CANCELLED";
    if (!partialCancellation && sale.approvedAmount !== sale.totalAmount)
      return Response.json({ success: false, message: "저장된 결제금액과 결제내역이 일치하지 않습니다." }, { status: 409 });
    const effectiveTotal = partialCancellation ? sale.approvedAmount : sale.totalAmount;
    const cancelledAmount = partialCancellation ? Math.max(0, sale.totalAmount - effectiveTotal) : 0;
    if (sale.approvedAmount !== effectiveTotal || effectiveTotal <= 0 || effectiveTotal > sale.totalAmount)
      return Response.json({ success: false, message: "저장된 결제금액과 결제내역이 일치하지 않습니다." }, { status: 409 });
    const discounts = sale.discounts.filter(discount => discount.amount > 0);
    const itemizedDiscounts = discounts.reduce((sum, discount) => sum + discount.amount, 0) === sale.discountAmount
      ? discounts : [];

    const agentUrl = new URL(process.env.DEVICE_AGENT_URL ?? "http://127.0.0.1:5168");
    if (agentUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(agentUrl.hostname))
      throw new Error("Device Agent 주소는 이 PC의 로컬 주소여야 합니다.");
    const [storeInfo, receiptLogo] = await Promise.all([getStoreInfo(), getReceiptLogoRaster()]);
    const response = await fetch(new URL("/api/printer/receipt", agentUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        storeInfo,
        receiptLogo,
        checkoutId: sale.checkoutId,
        isReprint: true,
        statusLabel: partialCancellation ? "일부취소" : null,
        tableLabel: sale.tableNos.map(tableNo => `${tableNo}T`).join("+"),
        orderedAt: sale.orderedAt.slice(0, 16).replace("T", " "),
        items: sale.items,
        subtotalAmount: sale.subtotalAmount,
        discountAmount: sale.discountAmount,
        discounts: itemizedDiscounts,
        cancelledAmount,
        totalAmount: effectiveTotal,
        remainingAmount: Math.max(0, effectiveTotal - sale.approvedAmount),
        payments: approvedPayments.map(payment => ({
          method: payment.method,
          amount: payment.appliedAmount,
          receivedAmount: payment.amount,
          prepaidCreditAmount: payment.prepaidCreditAmount,
          approvalNo: payment.approvalNo,
          cashReceived: payment.cashReceived,
          cashChange: payment.cashChange,
        })),
      }),
    });
    const result = await response.json() as { success?: boolean; jobId?: number; error?: string };
    if (!response.ok || !result.success)
      return Response.json({ success: false, message: result.error ?? "프린터 연결 상태를 확인해주세요." }, { status: 502 });
    return Response.json({ success: true, checkoutId: sale.checkoutId, jobId: result.jobId });
  } catch (error) {
    console.error("receipt print failed", error);
    return Response.json({ success: false, message: "영수증 출력에 실패했습니다. 프린터와 Device Agent 연결 상태를 확인해주세요." }, { status: 502 });
  }
}

async function latestCompletedCheckoutForTable(tableId: number): Promise<
  { checkoutId: number } | { status: number; message: string }
> {
  const [latestSession] = await db.select({ sessionId: tableSessions.sessionId, status: tableSessions.status })
    .from(tableSessions)
    .where(eq(tableSessions.tableId, tableId))
    .orderBy(desc(tableSessions.openedAt), desc(tableSessions.sessionId))
    .limit(1);
  if (!latestSession)
    return { status: 404, message: "선택한 테이블에 완료된 거래가 없습니다." };
  if (latestSession.status === "OPEN")
    return { status: 409, message: "현재 테이블은 결제 전 상태입니다. 결제 영수증을 출력할 수 없습니다." };
  if (latestSession.status !== "CLOSED")
    return { status: 409, message: "가장 최근 테이블 이용에 완료된 거래가 없습니다. 판매내역에서 거래를 직접 선택해 주세요." };

  const linkedCheckouts = await db.selectDistinct({ checkoutId: checkouts.checkoutId, status: checkouts.status, completedAt: checkouts.completedAt })
    .from(checkoutItems)
    .innerJoin(orderItems, eq(orderItems.orderItemId, checkoutItems.orderItemId))
    .innerJoin(orders, eq(orders.orderId, orderItems.orderId))
    .innerJoin(checkouts, eq(checkouts.checkoutId, checkoutItems.checkoutId))
    .where(eq(orders.sessionId, latestSession.sessionId));
  if (linkedCheckouts.length !== 1 || linkedCheckouts[0].status !== "PAID" || linkedCheckouts[0].completedAt === null)
    return { status: 409, message: "이 테이블의 최근 완료 거래를 한 건으로 확인할 수 없습니다. 판매내역에서 거래를 직접 선택해 주세요." };
  return { checkoutId: linkedCheckouts[0].checkoutId };
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
  if (!checkoutIds.length) return Response.json({ success: true, date: startDate, startDate, endDate, sales: [] });

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
      paymentId: payments.paymentId,
      checkoutId: payments.checkoutId,
      status: payments.status,
      amount: payments.amount,
      appliedAmount: payments.appliedAmount,
      paidAt: sql<string>`CONCAT(DATE_FORMAT(${payments.paidAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00')`,
      cancelledAt: sql<string | null>`CASE WHEN ${payments.cancelledAt} IS NULL THEN NULL ELSE CONCAT(DATE_FORMAT(${payments.cancelledAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00') END`,
      methodCode: paymentMethods.methodCode,
      methodName: paymentMethods.methodName,
      methodNameSnapshot: paymentOtherDetails.methodNameSnapshot,
      quantity: paymentOtherDetails.quantity,
      note: payments.note,
    }).from(payments)
      .innerJoin(paymentMethods, eq(paymentMethods.paymentMethodId, payments.paymentMethodId))
      .leftJoin(paymentOtherDetails, eq(paymentOtherDetails.paymentId, payments.paymentId))
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

  return Response.json({
    success: true,
    date: startDate,
    startDate,
    endDate,
    sales,
  });
}

async function detailResponse(checkoutId: number) {
  const sale = await loadSaleDetail(checkoutId);
  if (!sale) return Response.json({ success: false, message: "판매 거래를 찾을 수 없습니다." }, { status: 404 });
  return Response.json({ success: true, sale });
}

async function loadSaleDetail(checkoutId: number): Promise<SaleDetail | null> {
  const [checkout] = await db.select({
    checkoutId: checkouts.checkoutId,
    status: checkouts.status,
    subtotalAmount: checkouts.subtotalAmount,
    discountAmount: checkouts.discountAmount,
    totalAmount: checkouts.totalAmount,
    createdAt: sql<string>`CONCAT(DATE_FORMAT(${checkouts.createdAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00')`,
    completedAt: sql<string | null>`CASE WHEN ${checkouts.completedAt} IS NULL THEN NULL ELSE CONCAT(DATE_FORMAT(${checkouts.completedAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00') END`,
  }).from(checkouts).where(eq(checkouts.checkoutId, checkoutId)).limit(1);
  if (!checkout) return null;

  const itemRows = await db.select({
    checkoutItemId: checkoutItems.checkoutItemId,
    orderItemId: checkoutItems.orderItemId,
    itemName: orderItems.itemName,
    unitPrice: checkoutItems.unitPrice,
    qty: checkoutItems.qty,
    amount: checkoutItems.amount,
    sessionId: orders.sessionId,
    tableNo: diningTables.tableNo,
    orderedAt: sql<string>`CONCAT(DATE_FORMAT(${orders.orderedAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00')`,
  }).from(checkoutItems)
    .innerJoin(orderItems, eq(orderItems.orderItemId, checkoutItems.orderItemId))
    .innerJoin(orders, eq(orders.orderId, orderItems.orderId))
    .innerJoin(tableSessions, eq(tableSessions.sessionId, orders.sessionId))
    .innerJoin(diningTables, eq(diningTables.tableId, tableSessions.tableId))
    .where(eq(checkoutItems.checkoutId, checkoutId));
  const sessionIds = [...new Set(itemRows.map((item) => item.sessionId))];
  const itemIds = [...new Set(itemRows.map((item) => item.orderItemId))];
  const [discountRows, paymentRows, cancellationRows] = await Promise.all([
    sessionIds.length ? db.select({
      label: tableSessionDiscounts.label,
      amount: tableSessionDiscounts.discountAmount,
      createdAt: sql<string>`CONCAT(DATE_FORMAT(${tableSessionDiscounts.createdAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00')`,
    })
      .from(tableSessionDiscounts).where(inArray(tableSessionDiscounts.sessionId, sessionIds)) : [],
    db.select({
      paymentId: payments.paymentId,
      amount: payments.amount,
      appliedAmount: payments.appliedAmount,
      status: payments.status,
      approvalNo: payments.approvalNo,
      paidAt: sql<string>`CONCAT(DATE_FORMAT(${payments.paidAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00')`,
      cancelledAt: sql<string | null>`CASE WHEN ${payments.cancelledAt} IS NULL THEN NULL ELSE CONCAT(DATE_FORMAT(${payments.cancelledAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00') END`,
      methodCode: paymentMethods.methodCode,
      methodName: paymentMethods.methodName,
      methodNameSnapshot: paymentOtherDetails.methodNameSnapshot,
      quantity: paymentOtherDetails.quantity,
      note: payments.note,
      customerName: customers.name,
      customerPhone: customers.phone,
      staffName: staff.name,
    }).from(payments)
      .innerJoin(paymentMethods, eq(paymentMethods.paymentMethodId, payments.paymentMethodId))
      .leftJoin(paymentOtherDetails, eq(paymentOtherDetails.paymentId, payments.paymentId))
      .leftJoin(customers, eq(customers.customerId, payments.customerId))
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
  const ledgerRows = paymentRows.length ? await db.select({ paymentId: customerPrepaidLedger.paymentId, entryType: customerPrepaidLedger.entryType, amount: customerPrepaidLedger.amount })
    .from(customerPrepaidLedger).where(inArray(customerPrepaidLedger.paymentId, paymentRows.map(payment => payment.paymentId))) : [];
  const ledgerByPayment = new Map<number, { credit: number; reversal: number }>();
  ledgerRows.forEach(row => {
    if (row.paymentId === null) return;
    const current = ledgerByPayment.get(row.paymentId) ?? { credit: 0, reversal: 0 };
    if (row.entryType === "CARD_OVERPAYMENT" || row.entryType === "PAYMENT_OVERPAYMENT") current.credit += Math.max(0, Number(row.amount));
    if (row.entryType === "CARD_OVERPAYMENT_REVERSAL" || row.entryType === "PAYMENT_OVERPAYMENT_REVERSAL") current.reversal += Math.abs(Number(row.amount));
    ledgerByPayment.set(row.paymentId, current);
  });
  const relevantPayments = paymentRows.filter((payment) => includedPaymentStatuses.has(payment.status));
  const tables = [...new Set(itemRows.map((item) => item.tableNo))].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  const firstOrderedAt = itemRows.reduce<string | null>((earliest, item) => !earliest || item.orderedAt < earliest ? item.orderedAt : earliest, null);
  const latestPaymentAt = relevantPayments.reduce<string | null>((latest, payment) => !latest || payment.paidAt > latest ? payment.paidAt : latest, null);
  const transactionAt = [checkout.completedAt, latestPaymentAt, checkout.createdAt]
    .filter((value): value is string => value !== null)
    .reduce((latest, value) => value > latest ? value : latest);
  const sale: SaleDetail = {
    checkoutId,
    occurredAt: transactionAt,
    orderedAt: firstOrderedAt ?? checkout.createdAt,
    tableLabel: tables.length ? `${tables.join("·")}T` : "-",
    tableNos: tables,
    checkoutStatus: checkout.status,
    displayStatus: displayStatus(checkout.status, relevantPayments),
    subtotalAmount: won(checkout.subtotalAmount),
    discountAmount: won(checkout.discountAmount),
    totalAmount: won(checkout.totalAmount),
    approvedAmount: relevantPayments.filter((payment) => payment.status === "APPROVED").reduce((sum, payment) => sum + won(payment.appliedAmount), 0),
    items: itemRows.sort((a, b) => a.checkoutItemId - b.checkoutItemId).map((item) => ({ orderItemId: item.orderItemId, itemName: item.itemName, unitPrice: won(item.unitPrice), qty: item.qty, amount: won(item.amount) })),
    discounts: discountRows
      .filter(discount => !checkout.completedAt || discount.createdAt <= checkout.completedAt)
      .map(discount => ({ label: discount.label, amount: won(discount.amount) })),
    payments: relevantPayments.map((payment) => ({
      paymentId: payment.paymentId,
      method: paymentLabel(payment),
      methodCode: payment.methodCode,
      customerDisplayName: payment.methodCode === "CUSTOMER_PAYMENT"
        ? payment.customerName?.trim() || payment.customerPhone?.trim() || null
        : null,
      amount: won(payment.amount),
      appliedAmount: won(payment.appliedAmount),
      prepaidCreditAmount: ledgerByPayment.get(payment.paymentId)?.credit ?? 0,
      prepaidReversalAmount: ledgerByPayment.get(payment.paymentId)?.reversal ?? 0,
      status: payment.status,
      approvalNo: payment.approvalNo,
      paidAt: payment.paidAt,
      cancelledAt: payment.cancelledAt,
      staffName: payment.staffName,
      cashReceived: payment.methodCode === "CASH" ? (() => { const match = payment.note?.match(/^현금 수령 (\d+)원 \/ 거스름돈 (\d+)원$/); return match ? won(match[1]) : null; })() : null,
      cashChange: payment.methodCode === "CASH" ? (() => { const match = payment.note?.match(/^현금 수령 (\d+)원 \/ 거스름돈 (\d+)원$/); return match ? won(match[2]) : null; })() : null,
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
  return sale;
}
