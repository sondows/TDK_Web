import { NextResponse } from "next/server";

import { verifyActiveStaffCredentials } from "@/lib/auth";
import { isValidPin } from "@/lib/pin";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { staffCode?: unknown; pin?: unknown };
    const staffCode = typeof body.staffCode === "string" ? body.staffCode : "";
    const pin = typeof body.pin === "string" ? body.pin : "";

    if (!staffCode || !isValidPin(pin)) {
      return NextResponse.json({ success: false }, { status: 401 });
    }

    const staffMember = await verifyActiveStaffCredentials(staffCode, pin);
    if (!staffMember) {
      return NextResponse.json({ success: false }, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

