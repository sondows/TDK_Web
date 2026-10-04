import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { customerPrepaidLedger, customers } from "@/db/schema";
import { validateCustomerCreate } from "@/lib/customer";
import { getCurrentAdminStaff } from "@/lib/admin-auth";

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

async function authorize() {
  const member = await getCurrentAdminStaff();
  if (!member) return { error: json({ success: false, message: "로그인이 필요합니다." }, 401) };
  return { error: null };
}

export async function GET(request: Request) {
  try {
    const auth = await authorize();
    if (auth.error) return auth.error;
    const params = new URL(request.url).searchParams;
    const search = params.get("search")?.trim() ?? "";
    const includeInactive = params.get("includeInactive") === "1";
    if (search.length > 100) return json({ success: false, message: "검색어는 100자 이내로 입력해 주세요." }, 400);

    const filters = [];
    if (!includeInactive) filters.push(eq(customers.isActive, 1));
    if (search) filters.push(or(
      sql`LOCATE(${search}, ${customers.name}) > 0`,
      sql`LOCATE(${search}, ${customers.contactName}) > 0`,
      sql`LOCATE(${search}, ${customers.phone}) > 0`,
      sql`LOCATE(${search}, ${customers.email}) > 0`,
    ));

    const rows = await db.select({
      customerId: customers.customerId,
      name: customers.name,
      contactName: customers.contactName,
      phone: customers.phone,
      email: customers.email,
      memo: customers.memo,
      isPaymentManaged: customers.isPaymentManaged,
      usesFixedCoupon: customers.usesFixedCoupon,
      fixedCouponAmount: customers.fixedCouponAmount,
      fixedCouponBalancePolicy: customers.fixedCouponBalancePolicy,
      fixedCouponCashChangeEnabled: customers.fixedCouponCashChangeEnabled,
      fixedCouponCashChangeMinPercent: customers.fixedCouponCashChangeMinPercent,
      isActive: customers.isActive,
    }).from(customers).where(filters.length ? and(...filters) : undefined).orderBy(asc(customers.name), asc(customers.customerId));
    const ledgerRows = rows.length ? await db.select({
      customerId: customerPrepaidLedger.customerId,
      balance: sql<string>`COALESCE(SUM(${customerPrepaidLedger.amount}), 0)`,
    }).from(customerPrepaidLedger)
      .where(inArray(customerPrepaidLedger.customerId, rows.map(row => row.customerId)))
      .groupBy(customerPrepaidLedger.customerId) : [];
    const balances = new Map(ledgerRows.map(row => [row.customerId, Number(row.balance)]));
    return json({
      success: true,
      customers: rows.map(row => ({
        ...row,
        isPaymentManaged: row.isPaymentManaged === 1,
        usesFixedCoupon: row.usesFixedCoupon === 1,
        fixedCouponAmount: row.fixedCouponAmount === null ? null : Number(row.fixedCouponAmount),
        fixedCouponCashChangeEnabled: row.fixedCouponCashChangeEnabled === 1,
        isActive: row.isActive === 1,
        tradeBalance: balances.get(row.customerId) ?? 0,
      })),
    });
  } catch (error) {
    console.error("Failed to load customers", error);
    return json({ success: false, message: "고객 목록을 불러오지 못했습니다." }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authorize();
    if (auth.error) return auth.error;
    let body: unknown;
    try { body = await request.json(); } catch { return json({ success: false, message: "고객정보를 확인해 주세요." }, 400); }
    const { values, errors } = validateCustomerCreate(body);
    if (!values) return json({ success: false, message: "고객정보를 확인해 주세요.", errors }, 400);

    const inserted = await db.insert(customers).values(values);
    return json({ success: true, customerId: Number(inserted[0].insertId) }, 201);
  } catch (error) {
    console.error("Failed to create customer", error);
    return json({ success: false, message: "고객을 저장하지 못했습니다." }, 500);
  }
}
