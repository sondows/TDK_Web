import "server-only";

import { cookies } from "next/headers";
import { and, eq, gt, ne } from "drizzle-orm";
import { db } from "@/db";
import { adminSecurityOwners, staff, staffSessions } from "@/db/schema";
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
    loginId: staff.adminLoginId,
    name: staff.name,
    role: staff.role,
  }).from(staffSessions).innerJoin(staff, eq(staffSessions.staffId, staff.staffId)).where(and(
    eq(staffSessions.sessionTokenHash, hashSessionToken(token)),
    eq(staffSessions.status, "ACTIVE"),
    gt(staffSessions.loggedInAt, cutoff),
    eq(staff.isActive, 1),
    ne(staff.staffCode, "000"),
    eq(staff.adminEnabled, 1),
  )).limit(1);
  return member ?? null;
}

export type OwnerSecurityState = "NOT_OWNER" | "OWNER_UNCONFIGURED" | "NEEDS_REAUTH" | "AUTHORIZED";

export async function getOwnerSecurityState(): Promise<OwnerSecurityState> {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
  if (!token?.startsWith(ADMIN_TOKEN_PREFIX)) return "NOT_OWNER";
  const [record] = await db.select({
    staffId: staff.staffId, isActive: staff.isActive,
    adminEnabled: staff.adminEnabled,
    ownerStaffId: adminSecurityOwners.staffId,
    passwordHash: adminSecurityOwners.passwordHash,
    credentialState: adminSecurityOwners.credentialState,
    ownerReauthenticatedAt: staffSessions.ownerReauthenticatedAt,
  }).from(staffSessions)
    .innerJoin(staff, eq(staffSessions.staffId, staff.staffId))
    .leftJoin(adminSecurityOwners, eq(adminSecurityOwners.staffId, staff.staffId))
    .where(and(eq(staffSessions.sessionTokenHash, hashSessionToken(token)), eq(staffSessions.sessionType, "ADMIN"),
      eq(staffSessions.status, "ACTIVE"), eq(staff.isActive, 1), eq(staff.adminEnabled, 1), ne(staff.staffCode, "000")))
    .limit(1);
  if (!record || record.ownerStaffId !== record.staffId) return "NOT_OWNER";
  if (record.credentialState !== "ACTIVE" || !record.passwordHash) return "OWNER_UNCONFIGURED";
  const freshAfter = new Date(Date.now() - 5 * 60 * 1000);
  return record.ownerReauthenticatedAt && record.ownerReauthenticatedAt >= freshAfter ? "AUTHORIZED" : "NEEDS_REAUTH";
}

export async function isDesignatedOwnerStaff(staffId: number) {
  const [record] = await db.select({ ownerStaffId: adminSecurityOwners.staffId })
    .from(adminSecurityOwners).where(eq(adminSecurityOwners.staffId, staffId)).limit(1);
  return record?.ownerStaffId === staffId;
}

export async function requireOwnerSecurityAccess() {
  const state = await getOwnerSecurityState();
  if (state === "AUTHORIZED") return null;
  const status = state === "NOT_OWNER" ? 403 : 428;
  return Response.json({ success: false, code: state, message: state === "NOT_OWNER" ? "OWNER 보안 권한이 필요합니다." : "관리자 보안 비밀번호 인증이 필요합니다." }, { status });
}

export async function requireAdminAccess() {
  const member = await getCurrentAdminStaff();
  return member ? null : Response.json(
    { success: false, message: "ADM 사용 권한이 필요합니다." }, { status: 403 },
  );
}

/** Management APIs shared with POS keep POS permissions when no admin session is present. */
export async function requireAdminAccessForAdminSession() {
  if ((await cookies()).has(ADMIN_SESSION_COOKIE_NAME)) return requireAdminAccess();
  return null;
}
