import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { staffSessions } from "@/db/schema";
import { ADMIN_SESSION_COOKIE_NAME, adminSessionCookieOptions } from "@/lib/admin-auth";
import { hashSessionToken } from "@/lib/auth";

export async function POST() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
  try {
    if (token?.startsWith("admin.")) {
      await db.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: new Date() }).where(and(
        eq(staffSessions.sessionTokenHash, hashSessionToken(token)),
        eq(staffSessions.status, "ACTIVE"),
      ));
    }
  } catch (error) {
    console.error("Admin center logout failed", error);
    return NextResponse.json({ success: false, message: "로그아웃에 실패했습니다." }, { status: 500 });
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_SESSION_COOKIE_NAME, "", { ...adminSessionCookieOptions, maxAge: 0 });
  return response;
}
