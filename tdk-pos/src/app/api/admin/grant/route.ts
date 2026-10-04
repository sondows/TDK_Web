import { NextResponse } from "next/server";
import { sessionCookieSecure } from "@/lib/auth";
import { ADMIN_GRANT_COOKIE } from "@/lib/permissions";

/** Ends the temporary OWNER grant that is issued when entering the management area. */
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_GRANT_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieSecure,
    path: "/",
    maxAge: 0,
  });
  return response;
}
