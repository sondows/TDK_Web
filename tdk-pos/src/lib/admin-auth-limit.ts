import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminAuthAttempts } from "@/db/schema";
import { AUTH_FAILURE_LIMIT, authAttemptKey, canAttempt, nextFailedAttempt } from "@/lib/auth-attempt-policy";

const STATUS_REQUEST_LIMIT = 30;

async function removeExpiredRows() {
  await db.delete(adminAuthAttempts).where(sql`${adminAuthAttempts.updatedAt} < DATE_SUB(NOW(), INTERVAL 1 DAY)`);
}

async function readCounter(attemptKey: string) {
  const [row] = await db.select({ attemptCount: adminAuthAttempts.attemptCount,
    windowStartedAt: adminAuthAttempts.windowStartedAt })
    .from(adminAuthAttempts).where(eq(adminAuthAttempts.attemptKey, attemptKey)).limit(1);
  return row;
}

type CounterWriter = Pick<typeof db, "insert" | "select" | "update">;

async function advanceCounter(tx: CounterWriter, attemptKey: string, nowMs: number, limit: number) {
  await tx.insert(adminAuthAttempts).values({ attemptKey, windowStartedAt: new Date(nowMs), attemptCount: 0 })
    .onDuplicateKeyUpdate({ set: { attemptCount: sql`${adminAuthAttempts.attemptCount}` } });
  const [row] = await tx.select({ attemptCount: adminAuthAttempts.attemptCount,
    windowStartedAt: adminAuthAttempts.windowStartedAt })
    .from(adminAuthAttempts).where(eq(adminAuthAttempts.attemptKey, attemptKey)).limit(1).for("update");
  if (!row) return false;
  const next = nextFailedAttempt(row, nowMs, limit);
  if (next.allowed || next.attemptCount !== Number(row.attemptCount) ||
    next.windowStartedAt.getTime() !== row.windowStartedAt.getTime()) {
    await tx.update(adminAuthAttempts).set({ attemptCount: next.attemptCount,
      windowStartedAt: next.windowStartedAt, updatedAt: new Date(nowMs) })
      .where(eq(adminAuthAttempts.attemptKey, attemptKey));
  }
  return next.allowed;
}

/** Only checks this employee's failures. A shared NAT/IP bucket never blocks a valid colleague. */
export async function isAdminAuthAttemptAllowed(scope: string, account: string, _ip: string | null) {
  void _ip;
  const counter = await readCounter(authAttemptKey(scope, "account", account));
  return canAttempt(counter, Date.now(), AUTH_FAILURE_LIMIT);
}

/** Records a real credential failure in employee and IP failure buckets, atomically. */
export async function recordAdminAuthFailure(scope: string, account: string, ip: string | null) {
  const nowMs = Date.now();
  await removeExpiredRows();
  const keys = [authAttemptKey(scope, "account", account),
    ...(ip ? [authAttemptKey(scope, "ip", ip)] : [])];
  return db.transaction(async tx => {
    const results: boolean[] = [];
    for (const key of keys) results.push(await advanceCounter(tx, key, nowMs, AUTH_FAILURE_LIMIT));
    // IP failures are tracked independently; they must not change another employee's auth result.
    return results[0] ?? false;
  });
}

/** Successful authentication clears only that employee/stage failure count, never the shared IP count. */
export async function clearAdminAuthFailures(scope: string, account: string, _ip: string | null) {
  void _ip;
  const accountKey = authAttemptKey(scope, "account", account);
  await db.delete(adminAuthAttempts).where(eq(adminAuthAttempts.attemptKey, accountKey));
}

/** Separate IP-scoped request-abuse counter for unauthenticated ID/status and setup requests. */
export async function reserveAdminStatusAttempt(scope: string, ip: string | null) {
  if (!ip) return null;
  const nowMs = Date.now();
  await removeExpiredRows();
  const allowed = await db.transaction(async tx =>
    advanceCounter(tx, authAttemptKey(scope, "ip", ip), nowMs, STATUS_REQUEST_LIMIT));
  return allowed;
}
