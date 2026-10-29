import { NextResponse } from "next/server";
import { verifyActiveStaffCredentials } from "@/lib/auth";
import { isValidEmployeePin } from "@/lib/pin";
import { clearAdminLoginAttempts, isAdminLoginAttemptAllowed, reserveAdminLoginAttempt } from "@/lib/admin-login-limit";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { loginId?: unknown; pin?: unknown };
    const loginId = typeof body.loginId === "string" ? body.loginId.trim().toLowerCase() : "";
    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!/^[a-z][a-z0-9._-]{2,31}$/.test(loginId) || !isValidEmployeePin(pin)) return NextResponse.json({ success: false }, { status: 401 });
    const identity = loginId;
    const attemptKey = `pos-verify:${identity}`;
    if (!isAdminLoginAttemptAllowed(attemptKey)) return NextResponse.json({ success: false, message: "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." }, { status: 429, headers: { "Cache-Control": "no-store" } });
    const member = await verifyActiveStaffCredentials(identity, pin);
    if (!member) {
      if (!reserveAdminLoginAttempt(attemptKey)) return NextResponse.json({ success: false, message: "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." }, { status: 429, headers: { "Cache-Control": "no-store" } });
      return NextResponse.json({ success: false }, { status: 401 });
    }
    clearAdminLoginAttempts(attemptKey);
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const detail = error as { code?: string; cause?: { code?: string } };
    console.error("POS PIN verification unavailable", { code: detail?.code ?? detail?.cause?.code });
    return NextResponse.json({ success: false, message: "PIN 확인 서비스를 이용할 수 없습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
