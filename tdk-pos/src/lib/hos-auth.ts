import "server-only";

import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { staff, staffSessions } from "@/db/schema";
import { hashSessionToken } from "@/lib/auth";
import { HOS_SESSION_COOKIE_MAX_AGE_SECONDS, isHosSessionCurrentBusinessDate } from "@/lib/hos-session-policy";
import { getCurrentProgramTrust, programCookieName } from "@/lib/program-trust";

export const HOS_SESSION_COOKIE_NAME = "tdk_hos_session";
export const hosSessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: HOS_SESSION_COOKIE_MAX_AGE_SECONDS,
  path: "/",
};

export async function getCurrentHosStaff() {
  const token = (await cookies()).get(HOS_SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const [member] = await db.select({
    sessionId: staffSessions.staffSessionId,
    staffId: staff.staffId,
    staffCode: staff.staffCode,
    loginId: staff.adminLoginId,
    name: staff.name,
    role: staff.role,
    employeePinHash: staff.employeePinHash,
    trustTokenId: staffSessions.trustTokenId,
    sessionBusinessDate: sql<string>`DATE_FORMAT(${staffSessions.loggedInAt}, '%Y-%m-%d')`,
    currentBusinessDate: sql<string>`DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d')`,
  }).from(staffSessions).innerJoin(staff, eq(staffSessions.staffId, staff.staffId)).where(and(
    eq(staffSessions.sessionTokenHash, hashSessionToken(token)),
    eq(staffSessions.status, "ACTIVE"),
    eq(staffSessions.sessionType, "HOS"),
    eq(staff.isActive, 1),
    eq(staff.hosEnabled, 1),
    isNull(staff.terminatedAt),
    ne(staff.staffCode, "000"),
  )).limit(1);
  if (!member || !member.employeePinHash) return null;
  if (!isHosSessionCurrentBusinessDate(member.sessionBusinessDate, member.currentBusinessDate)) {
    await db.update(staffSessions).set({ status: "EXPIRED", loggedOutAt: new Date(), ownerReauthenticatedAt: null })
      .where(and(eq(staffSessions.staffSessionId, member.sessionId), eq(staffSessions.status, "ACTIVE")));
    return null;
  }
  const trust = await getCurrentProgramTrust("HOS", { tokenId: member.trustTokenId ?? undefined });
  if (!trust || member.trustTokenId !== trust.tokenId) return null;
  const trustCookie = (await cookies()).get(trust.cookieName)?.value;
  if (!trustCookie || !trust.cookieName.startsWith(programCookieName.HOS)) return null;
  return member;
}
