import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { kdsLoginAttempts } from "@/db/schema";
import { clearAdminLoginAttempts, isAdminLoginAttemptAllowed, reserveAdminLoginAttempt } from "@/lib/admin-login-limit";

const MAX_ATTEMPTS = 5;

/** Checks lockout state without counting valid credentials, permission errors, or DB failures. */
export async function isKdsLoginAttemptAllowed(staffId: number | null, employeeId: string) {
  const key = staffId === null ? `kds-unknown:${employeeId.toLowerCase()}` : `kds:${staffId}`;
  if (!isAdminLoginAttemptAllowed(key)) return false;
  if (staffId === null) return true;
  const [attempt] = await db.select({ attemptCount: kdsLoginAttempts.attemptCount,
    windowStartedAt: kdsLoginAttempts.windowStartedAt }).from(kdsLoginAttempts)
    .where(eq(kdsLoginAttempts.staffId, staffId)).limit(1);
  return !attempt || attempt.windowStartedAt.getTime() <= Date.now() - 15 * 60 * 1000 || attempt.attemptCount < MAX_ATTEMPTS;
}

/** Records a credential failure after PIN verification; unknown IDs use a small in-process bucket. */
export async function recordKdsLoginFailure(staffId: number | null, employeeId: string) {
  if (staffId === null) return reserveAdminLoginAttempt(`kds-unknown:${employeeId.toLowerCase()}`);
  const inProcessAllowed = reserveAdminLoginAttempt(`kds:${staffId}`);
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
  return inProcessAllowed && Boolean(attempt && attempt.attemptCount <= MAX_ATTEMPTS);
}

/** Enrollment passwords/OTP use their own in-process key; the existing IP cap remains persistent. */
export function reserveKdsEnrollmentAttempt(staffId: number | null, employeeId: string) {
  const key = staffId === null ? `kds-enroll-unknown:${employeeId.toLowerCase()}` : `kds-enroll:${staffId}`;
  return reserveAdminLoginAttempt(key);
}

export function clearKdsEnrollmentAttempts(staffId: number, employeeId: string) {
  clearAdminLoginAttempts(`kds-enroll:${staffId}`);
  clearAdminLoginAttempts(`kds-enroll-unknown:${employeeId.toLowerCase()}`);
}

export async function clearKdsLoginAttempts(staffId: number) {
  clearAdminLoginAttempts(`kds:${staffId}`);
  await db.delete(kdsLoginAttempts).where(eq(kdsLoginAttempts.staffId, staffId));
}
