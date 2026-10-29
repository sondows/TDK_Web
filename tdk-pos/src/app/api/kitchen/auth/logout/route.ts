import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, staffSessions } from "@/db/schema";
import { hashSessionToken } from "@/lib/auth";
import { KDS_SESSION_COOKIE_NAME, kdsSessionCookieOptions } from "@/lib/kds-auth";
import { isSameOriginRequest, kdsCookieSecureForRequest } from "@/lib/kds-device";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ success: false }, { status: 403 });
  const token = (await cookies()).get(KDS_SESSION_COOKIE_NAME)?.value;
  if (token) {
    const tokenHash = hashSessionToken(token);
    const [session] = await db.select({ staffId: staffSessions.staffId }).from(staffSessions).where(and(
      eq(staffSessions.sessionTokenHash, tokenHash), eq(staffSessions.sessionType, "KDS"),
    )).limit(1);
    await db.transaction(async tx => {
      await tx.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: new Date() }).where(and(
        eq(staffSessions.sessionTokenHash, tokenHash), eq(staffSessions.sessionType, "KDS"),
      ));
      if (session) await tx.insert(auditLogs).values({ staffId: session.staffId, actionType: "KDS_LOGOUT", entityType: "KDS_AUTH" });
    });
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set(KDS_SESSION_COOKIE_NAME, "", { ...kdsSessionCookieOptions, secure: kdsCookieSecureForRequest(request), maxAge: 0 });
  return response;
}
