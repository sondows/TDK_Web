import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, staff } from "@/db/schema";
import { hashKdsPin, isValidKdsPin } from "@/lib/auth";
import { getCurrentKdsStaff } from "@/lib/kds-auth";
import { isSameOriginRequest } from "@/lib/kds-device";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ success: false }, { status: 403 });
  const member = await getCurrentKdsStaff({ allowPinChange: true });
  if (!member || member.kdsPinChangeRequired !== 1) return NextResponse.json({ success: false, message: "PIN change is not available." }, { status: 401 });
  const body = await request.json().catch(() => null) as { pin?: unknown; confirm?: unknown } | null;
  if (typeof body?.pin !== "string" || !isValidKdsPin(body.pin) || body.pin !== body.confirm) {
    return NextResponse.json({ success: false, message: "Enter matching 6-digit PIN values." }, { status: 400 });
  }
  try {
    await db.transaction(async tx => {
      await tx.update(staff).set({ kdsPinHash: await hashKdsPin(body.pin as string), kdsPinChangeRequired: 0 }).where(eq(staff.staffId, member.staffId));
      await tx.insert(auditLogs).values({ staffId: member.staffId, actionType: "KDS_PIN_CHANGED", entityType: "KDS_AUTH" });
    });
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("KDS PIN change failed", error);
    return NextResponse.json({ success: false, message: "Could not change the KDS PIN." }, { status: 500 });
  }
}
