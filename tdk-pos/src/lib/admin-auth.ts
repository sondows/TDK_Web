import "server-only";

import { cookies } from "next/headers";
import { and, eq, gt, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { staff, staffSessions } from "@/db/schema";
import { createSessionToken, hashSessionToken, sessionCookieSecure, type CurrentStaff } from "@/lib/auth";

export const ADMIN_SESSION_COOKIE_NAME = "tdk_admin_session";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
const ADMIN_TOKEN_PREFIX = "admin.";

export const adminSessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: sessionCookieSecure,
  maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  path: "/",
};

export function normalizeAdminLoginId(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidAdminLoginId(value: string) {
  return /^[a-z][a-z0-9._-]{2,31}$/.test(value);
}

export function createAdminSessionToken() {
  return `${ADMIN_TOKEN_PREFIX}${createSessionToken()}`;
}

export async function getCurrentAdminStaff(): Promise<CurrentStaff | null> {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
  if (!token?.startsWith(ADMIN_TOKEN_PREFIX)) return null;
  const cutoff = new Date(Date.now() - ADMIN_SESSION_MAX_AGE_SECONDS * 1000);
  const [member] = await db.select({
    staffId: staff.staffId,
    staffCode: staff.staffCode,
    name: staff.name,
    role: staff.role,
  }).from(staffSessions).innerJoin(staff, eq(staffSessions.staffId, staff.staffId)).where(and(
    eq(staffSessions.sessionTokenHash, hashSessionToken(token)),
    eq(staffSessions.status, "ACTIVE"),
    gt(staffSessions.loggedInAt, cutoff),
    eq(staff.isActive, 1),
    eq(staff.role, "OWNER"),
    ne(staff.staffCode, "000"),
    isNotNull(staff.adminLoginId),
    isNotNull(staff.adminPinHash),
  )).limit(1);
  return member ?? null;
}
