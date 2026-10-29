import "server-only";

import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminAuthAttempts } from "@/db/schema";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function keyHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function attemptKeys(scope: string, account: string, ip: string | null) {
  const keys = [keyHash(`${scope}:account:${account}`)];
  if (ip) keys.push(keyHash(`${scope}:ip:${ip}`));
  return keys;
}

export async function isAdminAuthAttemptAllowed(scope: string, account: string, ip: string | null) {
  const keys = attemptKeys(scope, account, ip);
  for (const attemptKey of keys) {
    const [row] = await db.select({ attemptCount: adminAuthAttempts.attemptCount, windowStartedAt: adminAuthAttempts.windowStartedAt })
      .from(adminAuthAttempts).where(eq(adminAuthAttempts.attemptKey, attemptKey)).limit(1);
    if (row && row.windowStartedAt.getTime() > Date.now() - WINDOW_MS && row.attemptCount >= MAX_ATTEMPTS) return false;
  }
  return true;
}

/** Atomically records a failed credential attempt in both account and verified-IP buckets. */
export async function recordAdminAuthFailure(scope: string, account: string, ip: string | null) {
  const keys = attemptKeys(scope, account, ip);
  await db.delete(adminAuthAttempts).where(sql`${adminAuthAttempts.updatedAt} < DATE_SUB(NOW(), INTERVAL 1 DAY)`);
  const expired = sql`${adminAuthAttempts.windowStartedAt} <= DATE_SUB(NOW(), INTERVAL 15 MINUTE)`;
  for (const attemptKey of keys) {
    await db.insert(adminAuthAttempts).values({ attemptKey, windowStartedAt: new Date(), attemptCount: 1 }).onDuplicateKeyUpdate({
      set: {
        attemptCount: sql`IF(${expired}, 1, ${adminAuthAttempts.attemptCount} + 1)`,
        windowStartedAt: sql`IF(${expired}, NOW(), ${adminAuthAttempts.windowStartedAt})`,
        updatedAt: sql`NOW()`,
      },
    });
  }
  return isAdminAuthAttemptAllowed(scope, account, ip);
}

export async function clearAdminAuthFailures(scope: string, account: string, ip: string | null) {
  const keys = attemptKeys(scope, account, ip);
  for (const attemptKey of keys) await db.delete(adminAuthAttempts).where(eq(adminAuthAttempts.attemptKey, attemptKey));
}
