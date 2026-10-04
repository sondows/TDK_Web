import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { customerPrepaidLedger, customers } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

export async function GET(request: Request) {
  try {
    if (!await getCurrentStaff()) return json({ success: false, message: "POS 로그인이 필요합니다." }, 401);

    const search = new URL(request.url).searchParams.get("search")?.replace(/\D/g, "") ?? "";
    const includeBalance = new URL(request.url).searchParams.get("includeBalance") === "1";
    if (search.length > 100) return json({ success: false, message: "검색어는 100자 이내로 입력해 주세요." }, 400);

    const paymentManagedActive = and(
      eq(customers.isActive, 1),
      eq(customers.isPaymentManaged, 1),
    );
    const condition = search
      ? and(paymentManagedActive, sql`LOCATE(${search}, REPLACE(${customers.phone}, '-', '')) > 0`)
      : paymentManagedActive;
    const rows = await db.select({
      customerId: customers.customerId,
      name: customers.name,
      contactName: customers.contactName,
      phone: customers.phone,
      usesFixedCoupon: customers.usesFixedCoupon,
      fixedCouponAmount: customers.fixedCouponAmount,
      fixedCouponBalancePolicy: customers.fixedCouponBalancePolicy,
      fixedCouponCashChangeEnabled: customers.fixedCouponCashChangeEnabled,
      fixedCouponCashChangeMinPercent: customers.fixedCouponCashChangeMinPercent,
      sortOrder: customers.sortOrder,
    }).from(customers).where(condition).orderBy(asc(customers.sortOrder), asc(customers.name), asc(customers.customerId));

    if (!includeBalance || !rows.length) return json({ success: true, customers: rows.map(row => ({ ...row, usesFixedCoupon: row.usesFixedCoupon === 1, fixedCouponAmount: row.fixedCouponAmount === null ? null : Number(row.fixedCouponAmount) })) });
    const balanceRows = await db.select({
      customerId: customerPrepaidLedger.customerId,
      balance: sql<string>`COALESCE(SUM(${customerPrepaidLedger.amount}), 0)`,
    }).from(customerPrepaidLedger)
      .where(inArray(customerPrepaidLedger.customerId, rows.map(row => row.customerId)))
      .groupBy(customerPrepaidLedger.customerId);
    const balances = new Map(balanceRows.map(row => [row.customerId, Number(row.balance)]));
    return json({ success: true, customers: rows.map(row => ({ ...row, usesFixedCoupon: row.usesFixedCoupon === 1, fixedCouponAmount: row.fixedCouponAmount === null ? null : Number(row.fixedCouponAmount), tradeBalance: balances.get(row.customerId) ?? 0 })) });
  } catch (error) {
    console.error("Failed to search POS customers", error);
    return json({ success: false, message: "고객 목록을 불러오지 못했습니다." }, 500);
  }
}
