import "server-only";

import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { kdsAuthIpAttempts } from "@/db/schema";
import { sessionCookieSecure } from "@/lib/auth";
import { isExternalAdminHost } from "@/lib/host-access";
import { getKdsRateLimitIp } from "@/lib/kds-network-server";

export function kdsCookieSecureForRequest(request: Request) {
  return sessionCookieSecure || isExternalAdminHost(request.headers.get("host"));
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin"), host = request.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host.toLowerCase() === host.toLowerCase(); }
  catch { return false; }
}

/** Trust and initial credential writes require a schemeful same-origin browser request. */
export function isHttpsSameOriginRequest(request: Request) {
  if (!isSameOriginRequest(request)) return false;
  if (process.env.NODE_ENV !== "production") return true;
  try { return new URL(request.headers.get("origin") ?? "").protocol === "https:"; }
  catch { return false; }
}

async function reserveKdsIpBucket(scope: string, clientIp: string) {
  const ipHash = createHash("sha256").update(`${scope}\0${clientIp}`).digest("hex");
  await db.delete(kdsAuthIpAttempts).where(sql`${kdsAuthIpAttempts.updatedAt} < DATE_SUB(NOW(), INTERVAL 1 DAY)`);
  const attemptCount = await db.transaction(async tx => {
    await tx.insert(kdsAuthIpAttempts).values({ ipHash, windowStartedAt: new Date(), attemptCount: 0 })
      .onDuplicateKeyUpdate({ set: { attemptCount: sql`${kdsAuthIpAttempts.attemptCount}` } });
    const [row] = await tx.select({ attemptCount: kdsAuthIpAttempts.attemptCount,
      windowExpired: sql<boolean>`${kdsAuthIpAttempts.windowStartedAt} <= DATE_SUB(NOW(), INTERVAL 15 MINUTE)`.as("window_expired"),
    }).from(kdsAuthIpAttempts).where(eq(kdsAuthIpAttempts.ipHash, ipHash)).limit(1).for("update");
    if (!row) return null;
    const expired = Boolean(row.windowExpired);
    const nextAttemptCount = expired ? 1 : Number(row.attemptCount) + 1;
    const now = new Date();
    await tx.update(kdsAuthIpAttempts).set({
      attemptCount: nextAttemptCount,
      ...(expired ? { windowStartedAt: now } : {}),
      updatedAt: now,
    }).where(eq(kdsAuthIpAttempts.ipHash, ipHash));
    return nextAttemptCount;
  });
  return attemptCount !== null && attemptCount <= 30;
}

type KdsIpLimitScope = "id-status" | "master-auth" | "pin-login" | "pin-setup" |
  "initial-master-status" | "initial-master-register";
export type KdsIpLimitResult = "allowed" | "network-limited" | "scope-limited" | "ip-unavailable";

/** Reserves one network-wide and one phase-specific request; missing IPs never share a fallback bucket. */
export async function reserveKdsIpAttempt(scope: KdsIpLimitScope): Promise<KdsIpLimitResult> {
  const clientIp = await getKdsRateLimitIp();
  if (!clientIp) return "ip-unavailable";
  if (!await reserveKdsIpBucket("network", clientIp)) return "network-limited";
  return await reserveKdsIpBucket(scope, clientIp) ? "allowed" : "scope-limited";
}
