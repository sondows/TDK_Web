import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { kdsLoginAttempts } from "@/db/schema";
import { clearAdminLoginAttempts, reserveAdminLoginAttempt } from "@/lib/admin-login-limit";

const MAX_ATTEMPTS = 5;

/** Persistently limits attempts per known employee; unknown IDs use a small in-process bucket. */
export async function reserveKdsLoginAttempt(staffId: number | null, employeeId: string) {
  if (staffId === null) return reserveAdminLoginAttempt(`kds-unknown:${employeeId.toLowerCase()}`);
  if (!reserveAdminLoginAttempt(`kds:${staffId}`)) return false;

  const windowExpired = sql`${kdsLoginAttempts.windowStartedAt} <= DATE_SUB(NOW(), INTERVAL 15 MINUTE)`;
  await db.insert(kdsLoginAttempts).values({ staffId, windowStartedAt: new Date(), attemptCount: 1 }).onDuplicateKeyUpdate({
    set: {
      attemptCount: sql`IF(${windowExpired}, 1, ${kdsLoginAttempts.attemptCount} + 1)`,
      windowStartedAt: sql`IF(${windowExpired}, NOW(), ${kdsLoginAttempts.windowStartedAt})`,
      updatedAt: sql`NOW()`,
    },
  });

  const [attempt] = await db.select({ attemptCount: kdsLoginAttempts.attemptCount })
    .from(kdsLoginAttempts).where(eq(kdsLoginAttempts.staffId, staffId)).limit(1);
  return Boolean(attempt && attempt.attemptCount <= MAX_ATTEMPTS);
}

export async function clearKdsLoginAttempts(staffId: number) {
  clearAdminLoginAttempts(`kds:${staffId}`);
  await db.delete(kdsLoginAttempts).where(eq(kdsLoginAttempts.staffId, staffId));
}
