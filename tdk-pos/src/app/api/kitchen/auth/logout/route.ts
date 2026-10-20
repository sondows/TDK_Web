import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { kdsSessions } from "@/db/schema";
import { hashSessionToken } from "@/lib/auth";
import { KDS_SESSION_COOKIE_NAME, kdsSessionCookieOptions } from "@/lib/kds-auth";

export async function POST() {
  const token = (await cookies()).get(KDS_SESSION_COOKIE_NAME)?.value;
  if (token) await db.update(kdsSessions).set({ status: "LOGGED_OUT" }).where(eq(kdsSessions.sessionTokenHash, hashSessionToken(token)));
  const response = NextResponse.json({ success: true });
  response.cookies.set(KDS_SESSION_COOKIE_NAME, "", { ...kdsSessionCookieOptions, maxAge: 0 });
  return response;
}
