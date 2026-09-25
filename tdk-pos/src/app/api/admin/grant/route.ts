import { NextResponse } from "next/server";
import { ADMIN_GRANT_COOKIE } from "@/lib/permissions";

/** Ends the temporary OWNER grant that is issued when entering the management area. */
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_GRANT_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
