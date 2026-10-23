import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { staffSessions } from "@/db/schema";
import { hashSessionToken } from "@/lib/auth";
import { KDS_SESSION_COOKIE_NAME, kdsSessionCookieOptions } from "@/lib/kds-auth";

export async function POST() {
  const token = (await cookies()).get(KDS_SESSION_COOKIE_NAME)?.value;
  if (token) {
    const tokenHash = hashSessionToken(token);
    await db.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: new Date() }).where(eq(staffSessions.sessionTokenHash, tokenHash));
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set(KDS_SESSION_COOKIE_NAME, "", { ...kdsSessionCookieOptions, maxAge: 0 });
  return response;
}
