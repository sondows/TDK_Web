import { and, asc, eq, inArray, ne } from "drizzle-orm";

import { db } from "@/db";
import { checkouts, customers, paymentMethods, payments } from "@/db/schema";
import { GET as getSales } from "@/app/api/sales/route";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import type { SaleDetailResponse, SalesListResponse } from "@/lib/sales-types";

const todayInKorea = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

export async function GET(request: Request) {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "OWNER 권한이 필요합니다." }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    const checkoutId = Number(params.get("checkoutId"));
    if (Number.isSafeInteger(checkoutId) && checkoutId > 0) {
      const response = await getSales(new Request(`http://localhost/api/sales?checkoutId=${checkoutId}`));
      const result = await response.json() as SaleDetailResponse;
      return Response.json(result, { status: response.status });
    }

    if (params.get("paymentOptions") === "1") {
      const availableMethods = await db.select({ paymentMethodId: paymentMethods.paymentMethodId, methodName: paymentMethods.methodName,
        methodCode: paymentMethods.methodCode, methodType: paymentMethods.methodType }).from(paymentMethods)
        .where(and(eq(paymentMethods.isActive, 1), ne(paymentMethods.methodCode, "CUSTOMER_PAYMENT")))
        .orderBy(asc(paymentMethods.sortOrder), asc(paymentMethods.paymentMethodId));
      const [customerPaymentMethod] = await db.select({ paymentMethodId: paymentMethods.paymentMethodId }).from(paymentMethods)
        .where(and(eq(paymentMethods.methodCode, "CUSTOMER_PAYMENT"), eq(paymentMethods.isActive, 1))).limit(1);
      const correctionCustomers = await db.select({ customerId: customers.customerId, name: customers.name, phone: customers.phone }).from(customers)
        .where(and(eq(customers.isActive, 1), eq(customers.isPaymentManaged, 1))).orderBy(asc(customers.name), asc(customers.customerId));
      return Response.json({ success: true, availableMethods, customerPaymentMethodId: customerPaymentMethod?.paymentMethodId ?? null,
        correctionCustomers: correctionCustomers.map(customer => ({ customerId: customer.customerId, displayName: customer.name?.trim() || customer.phone?.trim() || "—" })) });
    }

    const today = todayInKorea();
    const response = await getSales(new Request(`http://localhost/api/sales?date=${today}`));
    const result = await response.json() as SalesListResponse;
    if (!response.ok || !result.success) return Response.json(result, { status: response.status });
    const sales = result.sales;
    const availableMethods = await db.select({
      paymentMethodId: paymentMethods.paymentMethodId,
      methodName: paymentMethods.methodName,
      methodCode: paymentMethods.methodCode,
      methodType: paymentMethods.methodType,
    }).from(paymentMethods).where(and(eq(paymentMethods.isActive, 1), ne(paymentMethods.methodCode, "CUSTOMER_PAYMENT")))
      .orderBy(asc(paymentMethods.sortOrder), asc(paymentMethods.paymentMethodId));
    const [customerPaymentMethod] = await db.select({ paymentMethodId: paymentMethods.paymentMethodId })
      .from(paymentMethods).where(and(eq(paymentMethods.methodCode, "CUSTOMER_PAYMENT"), eq(paymentMethods.isActive, 1))).limit(1);
    const correctionCustomers = await db.select({ customerId: customers.customerId, name: customers.name, phone: customers.phone })
      .from(customers).where(and(eq(customers.isActive, 1), eq(customers.isPaymentManaged, 1))).orderBy(asc(customers.name), asc(customers.customerId));
    const ids = sales.map(sale => sale.checkoutId);
    const summary = { total: 0, totalCount: 0, card: 0, cardCount: 0, cash: 0, cashCount: 0, other: 0, otherCount: 0,
      discount: 0, discountCount: 0, completedCount: 0, cancelledCount: 0 };
    if (ids.length) {
      const [checkoutRows, paymentRows] = await Promise.all([
        db.select({ checkoutId: checkouts.checkoutId, discountAmount: checkouts.discountAmount })
          .from(checkouts).where(inArray(checkouts.checkoutId, ids)),
        db.select({ checkoutId: payments.checkoutId, status: payments.status, appliedAmount: payments.appliedAmount, methodType: paymentMethods.methodType })
          .from(payments).innerJoin(paymentMethods, eq(payments.paymentMethodId, paymentMethods.paymentMethodId))
          .where(inArray(payments.checkoutId, ids)),
      ]);
      const approvedIds = new Set<number>();
      for (const payment of paymentRows) {
        if (payment.status !== "APPROVED") continue;
        approvedIds.add(payment.checkoutId);
        const amount = Number(payment.appliedAmount);
        summary.total += amount;
        if (payment.methodType === "CARD") { summary.card += amount; summary.cardCount += 1; }
        else if (payment.methodType === "CASH") { summary.cash += amount; summary.cashCount += 1; }
        else { summary.other += amount; summary.otherCount += 1; }
      }
      summary.totalCount = approvedIds.size;
      summary.discount = checkoutRows.reduce((sum, checkout) => sum + (approvedIds.has(checkout.checkoutId) ? Number(checkout.discountAmount) : 0), 0);
      summary.discountCount = checkoutRows.filter(checkout => approvedIds.has(checkout.checkoutId) && Number(checkout.discountAmount) > 0).length;
    }
    summary.completedCount = sales.filter(sale => sale.status === "COMPLETED" || sale.status === "PARTIALLY_CANCELLED").length;
    summary.cancelledCount = sales.filter(sale => sale.status === "CANCELLED" || sale.status === "PARTIALLY_CANCELLED").length;
    return Response.json({ success: true, date: today, summary, sales, availableMethods,
      customerPaymentMethodId: customerPaymentMethod?.paymentMethodId ?? null,
      correctionCustomers: correctionCustomers.map(customer => ({ customerId: customer.customerId, displayName: customer.name?.trim() || customer.phone?.trim() || "—" })) });
  } catch (error) {
    console.error("admin dashboard query failed", error);
    return Response.json({ success: false, message: "오늘 판매내역을 불러올 수 없습니다." }, { status: 500 });
  }
}
