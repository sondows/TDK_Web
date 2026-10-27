import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { staffSessions } from "@/db/schema";
import { hashSessionToken } from "@/lib/auth";
import { KDS_SESSION_COOKIE_NAME, kdsSessionCookieOptions } from "@/lib/kds-auth";
import { isSameOriginRequest, kdsCookieSecureForRequest } from "@/lib/kds-device";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ success: false }, { status: 403 });
  const token = (await cookies()).get(KDS_SESSION_COOKIE_NAME)?.value;
  if (token) {
    const tokenHash = hashSessionToken(token);
    await db.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: new Date() }).where(and(
      eq(staffSessions.sessionTokenHash, tokenHash), eq(staffSessions.sessionType, "KDS"),
    ));
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set(KDS_SESSION_COOKIE_NAME, "", { ...kdsSessionCookieOptions, secure: kdsCookieSecureForRequest(request), maxAge: 0 });
  return response;
}
