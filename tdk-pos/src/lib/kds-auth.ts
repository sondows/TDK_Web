import "server-only";

import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { staff, staffSessions } from "@/db/schema";
import { hashSessionToken, sessionCookieSecure, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";

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
    name: staff.name,
  }).from(staffSessions).innerJoin(staff, eq(staffSessions.staffId, staff.staffId)).where(and(
    eq(staffSessions.sessionTokenHash, hashSessionToken(token)),
    eq(staffSessions.status, "ACTIVE"),
    eq(staffSessions.sessionType, "KDS"),
    gt(staffSessions.loggedInAt, cutoff),
    eq(staff.isActive, 1),
    eq(staff.kdsEnabled, 1),
  )).limit(1);
  return member ?? null;
}
