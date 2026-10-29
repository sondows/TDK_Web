import { NextResponse } from "next/server";

import { verifyActiveStaffCredentials } from "@/lib/auth";
import { isValidEmployeePin } from "@/lib/pin";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { loginId?: unknown; pin?: unknown };
    const loginId = typeof body.loginId === "string" ? body.loginId.trim().toLowerCase() : "";
    const pin = typeof body.pin === "string" ? body.pin : "";

    if (!loginId || !isValidEmployeePin(pin)) {
      return NextResponse.json({ success: false }, { status: 401 });
    }

    const staffMember = await verifyActiveStaffCredentials(loginId, pin);
    if (!staffMember || staffMember.role !== "OWNER") {
      return NextResponse.json({ success: false }, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

