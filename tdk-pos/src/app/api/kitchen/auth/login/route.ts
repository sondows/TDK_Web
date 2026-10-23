import { NextResponse } from "next/server";
import { db } from "@/db";
import { staffSessions } from "@/db/schema";
import { createSessionToken, hashSessionToken, verifyActiveStaffCredentials } from "@/lib/auth";
import { clearAdminLoginAttempts, reserveAdminLoginAttempt } from "@/lib/admin-login-limit";
import { KDS_SESSION_COOKIE_NAME, kdsSessionCookieOptions } from "@/lib/kds-auth";

const invalid = () => NextResponse.json(
  { success: false, message: "직원코드 또는 4자리 POS PIN을 확인해 주세요." },
  { status: 401, headers: { "Cache-Control": "no-store" } },
);

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { staffCode?: unknown; pin?: unknown } | null;
  const staffCode = typeof body?.staffCode === "string" ? body.staffCode.trim() : "";
  const pin = typeof body?.pin === "string" ? body.pin : "";
  if (!staffCode || !/^\d{4}$/.test(pin) || staffCode === "000") return invalid();

  const attemptKey = `kds:${staffCode}`;
  if (!reserveAdminLoginAttempt(attemptKey)) {
    return NextResponse.json({ success: false, message: "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." }, { status: 429 });
  }

  try {
    const member = await verifyActiveStaffCredentials(staffCode, pin);
    if (!member) return invalid();

    const token = createSessionToken();
    await db.insert(staffSessions).values({
      staffId: member.staffId,
      sessionTokenHash: hashSessionToken(token),
      status: "ACTIVE",
    });
    clearAdminLoginAttempts(attemptKey);
    const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(KDS_SESSION_COOKIE_NAME, token, kdsSessionCookieOptions);
    return response;
  } catch (error) {
    console.error("KDS staff login failed", error);
    return NextResponse.json({ success: false, message: "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
