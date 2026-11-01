import "server-only";

import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { staff, staffSessions } from "@/db/schema";
import { hashSessionToken, sessionCookieSecure, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";
import { getCurrentProgramTrust } from "@/lib/program-trust";

export const KDS_SESSION_COOKIE_NAME = "tdk_kds_session";
export const kdsSessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: sessionCookieSecure,
  maxAge: SESSION_MAX_AGE_SECONDS,
  path: "/",
};

export async function getCurrentKdsStaff() {
  const token = (await cookies()).get(KDS_SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const cutoff = new Date(Date.now() - SESSION_MAX_AGE_SECONDS * 1000);
  const [member] = await db.select({
    staffId: staff.staffId,
    staffCode: staff.staffCode,
    loginId: staff.adminLoginId,
    name: staff.name,
    employeePinHash: staff.employeePinHash,
    managedDeviceId: staffSessions.managedDeviceId,
    trustTokenId: staffSessions.trustTokenId,
  }).from(staffSessions).innerJoin(staff, eq(staffSessions.staffId, staff.staffId)).where(and(
    eq(staffSessions.sessionTokenHash, hashSessionToken(token)),
    eq(staffSessions.status, "ACTIVE"),
    eq(staffSessions.sessionType, "KDS"),
    gt(staffSessions.loggedInAt, cutoff),
    eq(staff.isActive, 1),
    eq(staff.kdsEnabled, 1),
  )).limit(1);
  if (!member || member.staffCode === "000" || !member.employeePinHash) return null;
  const trust = await getCurrentProgramTrust("KDS", { tokenId: member.trustTokenId ?? undefined });
  return trust && member.trustTokenId === trust.tokenId ? member : null;
}
