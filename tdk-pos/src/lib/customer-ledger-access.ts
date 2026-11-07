import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { getCurrentHosStaff } from "@/lib/hos-auth";

/** Read-only customer trade history is available to ADM, POS, and HOS for active trade-managed customers. */
export async function canReadCustomerTradeLedger(customerId: number): Promise<boolean> {
  if (await getCurrentAdminStaff()) return true;
  if (!await getCurrentStaff() && !await getCurrentHosStaff()) return false;

  const [customer] = await db.select({ customerId: customers.customerId }).from(customers).where(and(
    eq(customers.customerId, customerId),
    eq(customers.isActive, 1),
    eq(customers.isPaymentManaged, 1),
  )).limit(1);
  return Boolean(customer);
}
