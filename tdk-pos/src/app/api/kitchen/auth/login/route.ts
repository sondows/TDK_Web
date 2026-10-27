import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, kdsTrustedDevices, staff, staffSessions } from "@/db/schema";
import { createSessionToken, hashSessionToken, verifyKdsPin } from "@/lib/auth";
import { clearKdsLoginAttempts, reserveKdsLoginAttempt } from "@/lib/kds-login-limit";
import { KDS_SESSION_COOKIE_NAME, kdsSessionCookieOptions } from "@/lib/kds-auth";
import { getCurrentKdsDevice, kdsCookieSecureForRequest, reserveKdsIpAttempt, isSameOriginRequest } from "@/lib/kds-device";

const failure = (status = 401, message = "Employee ID or KDS PIN is incorrect.") => NextResponse.json(
  { success: false, message }, { status, headers: { "Cache-Control": "no-store" } },
);
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return failure(403, "Request origin could not be verified.");
  const body = await request.json().catch(() => null) as { employeeId?: unknown; pin?: unknown } | null;
  const employeeId = typeof body?.employeeId === "string" ? body.employeeId.trim() : "";
  const pin = typeof body?.pin === "string" ? body.pin : "";
  if (!employeeId || employeeId.length > 30 || !/^\d{6}$/.test(pin) || employeeId === "000") return failure();
  try {
    if (!await reserveKdsIpAttempt()) return failure(429, "Too many attempts from this network. Try again in 15 minutes.");
    const [candidate] = await db.select({
      staffId: staff.staffId, kdsPinHash: staff.kdsPinHash, isActive: staff.isActive,
      kdsEnabled: staff.kdsEnabled, kdsTotpSecretEnc: staff.kdsTotpSecretEnc,
      kdsPinChangeRequired: staff.kdsPinChangeRequired,
    }).from(staff).where(eq(staff.staffCode, employeeId)).limit(1);
    if (!await reserveKdsLoginAttempt(candidate?.staffId ?? null, employeeId)) return failure(429, "Too many attempts. Try again in 15 minutes.");
    const validPin = Boolean(candidate && candidate.isActive === 1 && candidate.kdsEnabled === 1 &&
      candidate.kdsTotpSecretEnc && await verifyKdsPin(pin, candidate.kdsPinHash));
    const device = candidate && validPin ? await getCurrentKdsDevice(candidate.staffId) : null;
    const trusted = Boolean(device);
    const valid = Boolean(validPin && trusted);
    await db.insert(auditLogs).values({
      staffId: candidate?.staffId ?? null, actionType: valid ? "KDS_LOGIN_SUCCESS" : "KDS_LOGIN_FAILED",
      entityType: "KDS_AUTH", entityId: candidate?.staffId ?? null,
      description: `employeeId=${employeeId}; trustedDevice=${trusted ? "yes" : "no"}`,
    });
    if (!candidate || !validPin) return failure();
    if (!trusted) return failure(403, "Register this device with your enrollment password and Google Authenticator first.");
    const token = createSessionToken();
    await db.insert(staffSessions).values({
      staffId: candidate.staffId, deviceId: device!.deviceId,
      sessionTokenHash: hashSessionToken(token), sessionType: "KDS", status: "ACTIVE",
    });
    await db.update(kdsTrustedDevices).set({ lastUsedAt: new Date() }).where(eq(kdsTrustedDevices.deviceId, device!.deviceId));
    await clearKdsLoginAttempts(candidate.staffId);
    const response = NextResponse.json({ success: true, requiresPinChange: candidate.kdsPinChangeRequired === 1 }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(KDS_SESSION_COOKIE_NAME, token, { ...kdsSessionCookieOptions, secure: kdsCookieSecureForRequest(request) });
    return response;
  } catch (error) {
    console.error("KDS staff login failed", error);
    return NextResponse.json({ success: false, message: "KDS sign-in failed. Please retry." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
