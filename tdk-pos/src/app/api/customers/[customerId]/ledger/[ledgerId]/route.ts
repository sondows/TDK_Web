import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  checkoutItems, checkouts, customerPrepaidLedger, customers, diningTables,
  orderItemOptions, orderItems, orders, paymentMethods, paymentOtherDetails,
  payments, tableSessions,
} from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { salePlaceLabel } from "@/lib/sale-place-label";
import type { CustomerTradeDetail, CustomerTradeDetailResponse, TradeEntryType } from "@/lib/customer-trade";

const json = (body: CustomerTradeDetailResponse, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

function positiveId(value: string) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ customerId: string; ledgerId: string }> }) {
  if (!await getCurrentAdminStaff()) return json({ success: false, message: "로그인이 필요합니다." }, 401);
  const identifiers = await params;
  const customerId = positiveId(identifiers.customerId);
  const ledgerId = positiveId(identifiers.ledgerId);
  if (!customerId || !ledgerId) return json({ success: false, message: "거래를 확인해 주세요." }, 400);

  try {
    const [customer] = await db.select({ name: customers.name, phone: customers.phone })
      .from(customers).where(eq(customers.customerId, customerId)).limit(1);
    if (!customer) return json({ success: false, message: "고객을 찾지 못했습니다." }, 404);

    const [entry] = await db.select({
      ledgerId: customerPrepaidLedger.ledgerId,
      entryType: customerPrepaidLedger.entryType,
      amount: customerPrepaidLedger.amount,
      transactionAt: sql<string>`DATE_FORMAT(${customerPrepaidLedger.transactionAt}, '%Y-%m-%dT%H:%i:%s')`,
      createdAt: sql<string>`DATE_FORMAT(${customerPrepaidLedger.createdAt}, '%Y-%m-%dT%H:%i:%s')`,
      methodCode: customerPrepaidLedger.methodCode,
      adjustmentReason: customerPrepaidLedger.adjustmentReason,
      memo: customerPrepaidLedger.memo,
      paymentId: customerPrepaidLedger.paymentId,
      checkoutId: checkouts.checkoutId,
      paymentMethodName: paymentMethods.methodName,
      reversesLedgerId: customerPrepaidLedger.reversesLedgerId,
    }).from(customerPrepaidLedger)
      .leftJoin(payments, eq(payments.paymentId, customerPrepaidLedger.paymentId))
      .leftJoin(checkouts, eq(checkouts.checkoutId, payments.checkoutId))
      .leftJoin(paymentMethods, eq(paymentMethods.paymentMethodId, payments.paymentMethodId))
      .where(and(eq(customerPrepaidLedger.customerId, customerId), eq(customerPrepaidLedger.ledgerId, ledgerId)))
      .limit(1);
    if (!entry) return json({ success: false, message: "거래를 찾지 못했습니다." }, 404);

    // Match the list's complete-history order, including backdated manual entries.
    const history = await db.select({ ledgerId: customerPrepaidLedger.ledgerId, amount: customerPrepaidLedger.amount })
      .from(customerPrepaidLedger).where(eq(customerPrepaidLedger.customerId, customerId))
      .orderBy(asc(customerPrepaidLedger.transactionAt), asc(customerPrepaidLedger.ledgerId));
    let balanceCents = 0;
    let balanceBefore = 0;
    let balanceAfter = 0;
    for (const row of history) {
      if (row.ledgerId === ledgerId) balanceBefore = balanceCents / 100;
      balanceCents += Math.round(Number(row.amount) * 100);
      if (row.ledgerId === ledgerId) { balanceAfter = balanceCents / 100; break; }
    }

    const [payment] = entry.paymentId === null ? [] : await db.select({
      paymentId: payments.paymentId,
      checkoutId: payments.checkoutId,
      status: payments.status,
      amount: payments.amount,
      appliedAmount: payments.appliedAmount,
      methodCode: paymentMethods.methodCode,
      methodName: paymentMethods.methodName,
      methodNameSnapshot: paymentOtherDetails.methodNameSnapshot,
    }).from(payments)
      .innerJoin(paymentMethods, eq(paymentMethods.paymentMethodId, payments.paymentMethodId))
      .leftJoin(paymentOtherDetails, eq(paymentOtherDetails.paymentId, payments.paymentId))
      .where(eq(payments.paymentId, entry.paymentId)).limit(1);

    const [checkout] = !payment ? [] : await db.select({
      checkoutId: checkouts.checkoutId,
      status: checkouts.status,
      subtotalAmount: checkouts.subtotalAmount,
      discountAmount: checkouts.discountAmount,
      totalAmount: checkouts.totalAmount,
    }).from(checkouts).where(eq(checkouts.checkoutId, payment.checkoutId)).limit(1);

    const itemRows = !checkout ? [] : await db.select({
      checkoutItemId: checkoutItems.checkoutItemId,
      orderItemId: checkoutItems.orderItemId,
      name: orderItems.itemName,
      qty: checkoutItems.qty,
      unitPrice: checkoutItems.unitPrice,
      amount: checkoutItems.amount,
      note: orderItems.note,
      sessionKind: tableSessions.sessionKind,
      displayName: tableSessions.displayName,
      tableNo: diningTables.tableNo,
    }).from(checkoutItems)
      .innerJoin(orderItems, eq(orderItems.orderItemId, checkoutItems.orderItemId))
      .innerJoin(orders, eq(orders.orderId, orderItems.orderId))
      .innerJoin(tableSessions, eq(tableSessions.sessionId, orders.sessionId))
      .leftJoin(diningTables, eq(diningTables.tableId, tableSessions.tableId))
      .where(eq(checkoutItems.checkoutId, checkout.checkoutId))
      .orderBy(asc(checkoutItems.checkoutItemId));

    const orderItemIds = [...new Set(itemRows.map(item => item.orderItemId))];
    const options = orderItemIds.length ? await db.select({
      orderItemId: orderItemOptions.orderItemId,
      optionName: orderItemOptions.optionName,
    }).from(orderItemOptions)
      .where(inArray(orderItemOptions.orderItemId, orderItemIds))
      .orderBy(asc(orderItemOptions.orderItemOptionId)) : [];
    const optionsByItem = new Map<number, string[]>();
    for (const option of options) optionsByItem.set(option.orderItemId, [
      ...(optionsByItem.get(option.orderItemId) ?? []), option.optionName,
    ]);
    const places = [...new Set(itemRows.map(item => {
      if (item.sessionKind !== "DINE_IN") return item.displayName || "포장";
      const table = item.displayName || item.tableNo;
      return table ? salePlaceLabel(table) : null;
    }).filter((place): place is string => Boolean(place)))];

    const [original] = entry.reversesLedgerId === null ? [] : await db.select({
      ledgerId: customerPrepaidLedger.ledgerId,
      paymentId: customerPrepaidLedger.paymentId,
    }).from(customerPrepaidLedger)
      .where(and(eq(customerPrepaidLedger.customerId, customerId), eq(customerPrepaidLedger.ledgerId, entry.reversesLedgerId)))
      .limit(1);

    const detail: CustomerTradeDetail = {
      entry: { ...entry, entryType: entry.entryType as TradeEntryType, amount: Number(entry.amount), balance: balanceAfter },
      balanceBefore,
      customerName: customer.name?.trim() || customer.phone?.trim() || "—",
      payment: payment ? {
        paymentId: payment.paymentId,
        methodName: payment.methodCode === "CUSTOMER_PAYMENT" ? "고객결제" : payment.methodNameSnapshot || payment.methodName,
        status: payment.status,
        amount: Number(payment.amount),
        appliedAmount: Number(payment.appliedAmount),
      } : null,
      checkout: checkout ? {
        checkoutId: checkout.checkoutId,
        status: checkout.status,
        place: places.length ? places.join(" · ") : null,
        subtotalAmount: Number(checkout.subtotalAmount),
        discountAmount: Number(checkout.discountAmount),
        totalAmount: Number(checkout.totalAmount),
        items: itemRows.map(item => ({
          checkoutItemId: item.checkoutItemId,
          name: item.name,
          qty: item.qty,
          unitPrice: Number(item.unitPrice),
          amount: Number(item.amount),
          options: optionsByItem.get(item.orderItemId) ?? [],
          note: item.note,
        })),
      } : null,
      original: original ?? null,
    };
    return json({ success: true, detail });
  } catch (error) {
    console.error("Failed to load customer trade detail", error);
    return json({ success: false, message: "거래 상세를 불러오지 못했습니다." }, 500);
  }
}
