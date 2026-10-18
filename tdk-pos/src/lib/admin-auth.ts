import "server-only";

import { cookies } from "next/headers";
import { and, eq, gt, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { staff, staffSessions } from "@/db/schema";
import { createSessionToken, hashSessionToken, sessionCookieSecure, type CurrentStaff } from "@/lib/auth";
import { getPrivilegedStaff } from "@/lib/permissions";

export const ADMIN_SESSION_COOKIE_NAME = "tdk_admin_session";
export type AdminPermission = "NONE" | "READ_ONLY" | "READ_WRITE";
export const canAccessAdmin = (permission: AdminPermission) => permission !== "NONE";
export const canWriteAdmin = (permission: AdminPermission) => permission === "READ_WRITE";
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

export async function getCurrentAdminStaff(): Promise<(CurrentStaff & { adminPermission: AdminPermission }) | null> {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
  if (!token?.startsWith(ADMIN_TOKEN_PREFIX)) return null;
  const cutoff = new Date(Date.now() - ADMIN_SESSION_MAX_AGE_SECONDS * 1000);
  const [member] = await db.select({
    staffId: staff.staffId,
    staffCode: staff.staffCode,
    name: staff.name,
    role: staff.role,
    adminPermission: staff.adminPermission,
  }).from(staffSessions).innerJoin(staff, eq(staffSessions.staffId, staff.staffId)).where(and(
    eq(staffSessions.sessionTokenHash, hashSessionToken(token)),
    eq(staffSessions.status, "ACTIVE"),
    gt(staffSessions.loggedInAt, cutoff),
    eq(staff.isActive, 1),
    ne(staff.staffCode, "000"),
    isNotNull(staff.adminLoginId),
    isNotNull(staff.adminPinHash),
  )).limit(1);
  return member && canAccessAdmin(member.adminPermission) ? member : null;
}

export async function requireAdminWrite() {
  const member = await getCurrentAdminStaff();
  return member && canWriteAdmin(member.adminPermission) ? null : Response.json(
    { success: false, message: "관리센터 읽기·쓰기 권한이 필요합니다." }, { status: 403 },
  );
}

/** Management APIs shared with POS keep POS permissions when no admin session is present. */
export async function requireAdminWriteForAdminSession() {
  if ((await cookies()).has(ADMIN_SESSION_COOKIE_NAME)) return requireAdminWrite();
  const actor = await getPrivilegedStaff();
  if (!actor) return null;
  const [member] = await db.select({ permission: staff.adminPermission, adminLoginId: staff.adminLoginId })
    .from(staff).where(eq(staff.staffId, actor.staffId)).limit(1);
  if (member?.adminLoginId && !canWriteAdmin(member.permission)) return Response.json(
    { success: false, message: "관리센터 읽기·쓰기 권한이 필요합니다." }, { status: 403 },
  );
  return null;
}
