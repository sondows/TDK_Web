import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { checkouts, paymentMethods, payments } from "@/db/schema";
import { GET as getSales } from "@/app/api/sales/route";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import type { SaleDetailResponse, SalesListResponse } from "@/lib/sales-types";

const todayInKorea = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

export async function GET(request: Request) {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "OWNER 권한이 필요합니다." }, { status: 403 });
  try {
    const checkoutId = Number(new URL(request.url).searchParams.get("checkoutId"));
    if (Number.isSafeInteger(checkoutId) && checkoutId > 0) {
      const response = await getSales(new Request(`http://localhost/api/sales?checkoutId=${checkoutId}`));
      const result = await response.json() as SaleDetailResponse;
      return Response.json(result, { status: response.status });
    }

    const today = todayInKorea();
    const response = await getSales(new Request(`http://localhost/api/sales?date=${today}`));
    const result = await response.json() as SalesListResponse;
    if (!response.ok || !result.success) return Response.json(result, { status: response.status });
    const sales = result.sales;
    const ids = sales.map(sale => sale.checkoutId);
    const summary = { total: 0, card: 0, cash: 0, other: 0, discount: 0, completedCount: 0, cancelledCount: 0 };
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
        if (payment.methodType === "CARD") summary.card += amount;
        else if (payment.methodType === "CASH") summary.cash += amount;
        else summary.other += amount;
      }
      summary.discount = checkoutRows.reduce((sum, checkout) => sum + (approvedIds.has(checkout.checkoutId) ? Number(checkout.discountAmount) : 0), 0);
    }
    summary.completedCount = sales.filter(sale => sale.status === "COMPLETED" || sale.status === "PARTIALLY_CANCELLED").length;
    summary.cancelledCount = sales.filter(sale => sale.status === "CANCELLED" || sale.status === "PARTIALLY_CANCELLED").length;
    return Response.json({ success: true, date: today, summary, sales });
  } catch (error) {
    console.error("admin dashboard query failed", error);
    return Response.json({ success: false, message: "오늘 판매내역을 불러올 수 없습니다." }, { status: 500 });
  }
}
