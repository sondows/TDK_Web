import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { reserveKdsEnrollmentAttempt } from "@/lib/kds-login-limit";
import { verifyKdsPassword } from "@/lib/auth";
import { encryptTotpSecret, newTotpSecret, reserveKdsIpAttempt, isSameOriginRequest } from "@/lib/kds-device";

const fail = (status = 401) => NextResponse.json({ success: false, message: "Employee ID or enrollment password is incorrect." }, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403);
  const body = await request.json().catch(() => null) as { employeeId?: unknown; password?: unknown } | null;
  const employeeId = typeof body?.employeeId === "string" ? body.employeeId.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!employeeId || employeeId.length > 30 || employeeId === "000") return fail();
  try {
    if (!await reserveKdsIpAttempt()) return fail(429);
    const [member] = await db.select({
      staffId: staff.staffId, passwordHash: staff.kdsPasswordHash, active: staff.isActive,
      enabled: staff.kdsEnabled, totpSecret: staff.kdsTotpSecretEnc,
    }).from(staff).where(eq(staff.staffCode, employeeId)).limit(1);
    if (member && !reserveKdsEnrollmentAttempt(member.staffId, employeeId)) return fail(429);
    if (!member && !reserveKdsEnrollmentAttempt(null, employeeId)) return fail(429);
    if (!member || member.active !== 1 || member.enabled !== 1 || !await verifyKdsPassword(password, member.passwordHash)) return fail();
    if (member.totpSecret) return NextResponse.json({ success: true, mode: "approve-device" }, { headers: { "Cache-Control": "no-store" } });
    const secret = newTotpSecret();
    await db.update(staff).set({
      kdsTotpPendingSecretEnc: encryptTotpSecret(secret),
      kdsTotpPendingExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }).where(eq(staff.staffId, member.staffId));
    const label = encodeURIComponent(`TDK KDS:${employeeId}`);
    return NextResponse.json({
      success: true, mode: "setup-authenticator", secret,
      otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=TDK-POS&digits=6&period=30`,
    }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    console.error("KDS device enrollment start failed", error);
    return NextResponse.json({ success: false, message: "Could not start device registration." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
