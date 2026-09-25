import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/db";
import { staffSessions } from "@/db/schema";
import {
  hashSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";

export async function POST() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await db
      .update(staffSessions)
      .set({ status: "LOGGED_OUT", loggedOutAt: new Date() })
      .where(
        and(
          eq(staffSessions.sessionTokenHash, hashSessionToken(token)),
          eq(staffSessions.status, "ACTIVE")
        )
      );
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...sessionCookieOptions,
    maxAge: 0,
  });
  return response;
}
