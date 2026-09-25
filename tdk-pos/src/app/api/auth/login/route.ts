import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { staff, staffSessions } from "@/db/schema";
import {
  createSessionToken,
  hashSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
  verifyPin,
} from "@/lib/auth";

const LOGIN_FAILURE_MESSAGE = "직원코드 또는 PIN이 올바르지 않습니다.";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const staffCode = typeof body.staffCode === "string" ? body.staffCode.trim() : "";
    const pin = typeof body.pin === "string" ? body.pin : "";

    if (!staffCode || !pin) {
      return NextResponse.json(
        { success: false, message: LOGIN_FAILURE_MESSAGE },
        { status: 401 }
      );
    }

    const [staffMember] = await db
      .select({
        staffId: staff.staffId,
        pinHash: staff.pinHash,
      })
      .from(staff)
      .where(and(eq(staff.staffCode, staffCode), eq(staff.isActive, 1)))
      .limit(1);

    if (!staffMember || !(await verifyPin(pin, staffMember.pinHash))) {
      return NextResponse.json(
        { success: false, message: LOGIN_FAILURE_MESSAGE },
        { status: 401 }
      );
    }

    const token = createSessionToken();
    await db.insert(staffSessions).values({
      staffId: staffMember.staffId,
      sessionTokenHash: hashSessionToken(token),
      status: "ACTIVE",
    });

    const response = NextResponse.json({ success: true });
    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions);
    return response;
  } catch (error) {
    console.error("직원 로그인 처리 오류:", error);
    return NextResponse.json(
      { success: false, message: "로그인 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
