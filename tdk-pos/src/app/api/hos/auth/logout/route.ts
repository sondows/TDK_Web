import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { staffSessions } from "@/db/schema";
import { hashSessionToken } from "@/lib/auth";
import { getCurrentHosStaff, HOS_SESSION_COOKIE_NAME, hosSessionCookieOptions } from "@/lib/hos-auth";

export async function POST() {
  const current = await getCurrentHosStaff();
  const token = (await cookies()).get(HOS_SESSION_COOKIE_NAME)?.value;
  if (!current || !token) return NextResponse.json({ success: false }, { status: 401 });
  await db.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: new Date(), ownerReauthenticatedAt: null })
    .where(and(eq(staffSessions.staffId, current.staffId), eq(staffSessions.sessionTokenHash, hashSessionToken(token)),
      eq(staffSessions.sessionType, "HOS"), eq(staffSessions.status, "ACTIVE"), isNull(staffSessions.loggedOutAt)));
  const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(HOS_SESSION_COOKIE_NAME, "", { ...hosSessionCookieOptions, maxAge: 0 });
  return response;
}
