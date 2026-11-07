import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { customerPrepaidLedger, customers } from "@/db/schema";
import { getCurrentHosStaff } from "@/lib/hos-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!await getCurrentHosStaff()) return Response.json({ success: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const includeBalance = new URL(request.url).searchParams.get("includeBalance") === "1";
    const rows = await db.select({ customerId: customers.customerId, name: customers.name,
      isPaymentManaged: customers.isPaymentManaged, createdAt: customers.createdAt, sortOrder: customers.sortOrder })
      .from(customers).where(eq(customers.isActive, 1))
      .orderBy(asc(customers.sortOrder), asc(customers.name), asc(customers.customerId));
    const ids = rows.map(row => row.customerId);
    const balanceRows = includeBalance && ids.length ? await db.select({ customerId: customerPrepaidLedger.customerId,
      balance: sql<string>`COALESCE(SUM(${customerPrepaidLedger.amount}), 0)` })
      .from(customerPrepaidLedger).where(inArray(customerPrepaidLedger.customerId, ids)).groupBy(customerPrepaidLedger.customerId) : [];
    const balances = new Map(balanceRows.map(row => [row.customerId, Number(row.balance)]));
    return Response.json({ success: true, customers: rows.map(row => ({ customerId: row.customerId, name: row.name,
      isPaymentManaged: row.isPaymentManaged === 1, createdAt: row.createdAt,
      ...(includeBalance ? { tradeBalance: balances.get(row.customerId) ?? 0 } : {}) }))
      .sort((a, b) => Date.parse(String(b.createdAt)) - Date.parse(String(a.createdAt)) || b.customerId - a.customerId) },
    { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("HOS customer list unavailable", { code: (error as { code?: string }).code });
    return Response.json({ success: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
