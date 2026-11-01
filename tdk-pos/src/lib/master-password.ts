import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { verifySecurityPassword } from "@/lib/auth";

/** Verifies the one employee master credential used by program and OWNER reauthentication flows. */
export async function verifyMasterPassword(employeeId: number, password: string): Promise<boolean> {
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0 ||
    typeof password !== "string" || password.length === 0 || password.length > 128) return false;

  const [employee] = await db.select({
    hash: staff.securityPasswordHash,
  }).from(staff).where(and(
    eq(staff.staffId, employeeId),
    eq(staff.isActive, 1),
    isNull(staff.terminatedAt),
  )).limit(1);

  if (!employee?.hash) return false;
  return verifySecurityPassword(password, employee.hash);
}
