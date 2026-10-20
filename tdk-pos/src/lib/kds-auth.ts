import "server-only";

import { cookies } from "next/headers";
import { and, eq, gt, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { kdsAccounts, kdsSessions, staff, staffSessions } from "@/db/schema";
import { hashSessionToken, sessionCookieSecure, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";

export const KDS_SESSION_COOKIE_NAME = "tdk_kds_session";
export const kdsSessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: sessionCookieSecure,
  maxAge: SESSION_MAX_AGE_SECONDS,
  path: "/",
};

export function normalizeKdsLoginId(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidKdsLoginId(value: string) {
  return /^[a-z][a-z0-9._-]{2,31}$/.test(value);
}

export async function getCurrentKdsAccount() {
  const token = (await cookies()).get(KDS_SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const cutoff = new Date(Date.now() - SESSION_MAX_AGE_SECONDS * 1000);
  const [account] = await db.select({
    kdsAccountId: kdsAccounts.kdsAccountId,
    loginId: kdsAccounts.loginId,
  }).from(kdsSessions).innerJoin(kdsAccounts, eq(kdsSessions.kdsAccountId, kdsAccounts.kdsAccountId)).where(and(
    eq(kdsSessions.sessionTokenHash, hashSessionToken(token)),
    eq(kdsSessions.status, "ACTIVE"),
    gt(kdsSessions.loggedInAt, cutoff),
    eq(kdsAccounts.isActive, 1),
  )).limit(1);
  if (account) return account;

  // Admin Center credentials use staff_sessions but have their own KDS cookie.
  // This keeps KDS authentication separate from POS/admin browser sessions.
  const [staffAccount] = await db.select({
    kdsAccountId: staff.staffId,
    loginId: sql<string>`COALESCE(${staff.adminLoginId}, '')`,
  }).from(staffSessions).innerJoin(staff, eq(staffSessions.staffId, staff.staffId)).where(and(
    eq(staffSessions.sessionTokenHash, hashSessionToken(token)),
    eq(staffSessions.status, "ACTIVE"),
    gt(staffSessions.loggedInAt, cutoff),
    eq(staff.isActive, 1),
    ne(staff.staffCode, "000"),
    ne(staff.adminPermission, "NONE"),
    isNotNull(staff.adminLoginId),
    isNotNull(staff.adminPinHash),
  )).limit(1);
  return staffAccount ?? null;
}
