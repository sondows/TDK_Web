import { NextResponse } from "next/server";

import { verifyActiveStaffCredentials } from "@/lib/auth";
import { isValidPin } from "@/lib/pin";
import { reserveAdminLoginAttempt } from "@/lib/admin-login-limit";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { staffCode?: unknown; pin?: unknown };
    const staffCode = typeof body.staffCode === "string" ? body.staffCode : "";
    const pin = typeof body.pin === "string" ? body.pin : "";

    if (!staffCode || !isValidPin(pin)) {
      return NextResponse.json({ success: false }, { status: 401 });
    }

    if (!reserveAdminLoginAttempt(`pos-verify:${staffCode.trim()}`)) {
      return NextResponse.json({ success: false, message: "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." }, { status: 429, headers: { "Cache-Control": "no-store" } });
    }

    const staffMember = await verifyActiveStaffCredentials(staffCode, pin, { allowShared: true });
    if (!staffMember) {
      return NextResponse.json({ success: false }, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
