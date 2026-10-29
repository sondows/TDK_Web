import { eq } from "drizzle-orm";
import { randomInt } from "crypto";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, managedDevices, staff } from "@/db/schema";
import { clearKdsEnrollmentAttempts, reserveKdsEnrollmentAttempt } from "@/lib/kds-login-limit";
import { verifyKdsPassword } from "@/lib/auth";
import {
  createKdsDeviceToken, hashKdsDeviceToken,
  decryptTotpSecret, reserveKdsIpAttempt, isSameOriginRequest, verifyTotp,
} from "@/lib/kds-device";

const fail = (status = 401) => NextResponse.json({ success: false, message: "Registration could not be verified. Check the password and Google Authenticator code." }, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403);
  const body = await request.json().catch(() => null) as { employeeId?: unknown; password?: unknown; code?: unknown; deviceLabel?: unknown; deviceType?: unknown } | null;
  const employeeId = typeof body?.employeeId === "string" ? body.employeeId.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const code = typeof body?.code === "string" ? body.code : "";
  const deviceLabel = typeof body?.deviceLabel === "string" ? body.deviceLabel.trim().slice(0, 120) : "";
  const deviceType = body?.deviceType;
  if (!employeeId || employeeId.length > 30 || employeeId === "000" || !/^\d{6}$/.test(code) ||
      !deviceLabel || !["POS", "KDS"].includes(String(deviceType))) return fail(400);
  try {
    if (!await reserveKdsIpAttempt()) return fail(429);
    const [member] = await db.select({
      staffId: staff.staffId, passwordHash: staff.kdsPasswordHash, active: staff.isActive,
      enabled: staff.kdsEnabled, totpSecret: staff.kdsTotpSecretEnc,
      pendingSecret: staff.kdsTotpPendingSecretEnc, pendingExpiresAt: staff.kdsTotpPendingExpiresAt,
    }).from(staff).where(eq(staff.staffCode, employeeId)).limit(1);
    if (member && !reserveKdsEnrollmentAttempt(member.staffId, employeeId)) return fail(429);
    if (!member && !reserveKdsEnrollmentAttempt(null, employeeId)) return fail(429);
    if (!member || member.active !== 1 || member.enabled !== 1 || !await verifyKdsPassword(password, member.passwordHash)) return fail();

    let encryptedTotp = member.totpSecret;
    if (!member.totpSecret && member.pendingSecret) {
      if (!member.pendingExpiresAt || member.pendingExpiresAt.getTime() <= Date.now() || !verifyTotp(decryptTotpSecret(member.pendingSecret), code)) return fail();
      encryptedTotp = member.pendingSecret;
    } else if (!member.totpSecret || !verifyTotp(decryptTotpSecret(member.totpSecret), code)) return fail();
    if (!encryptedTotp) return fail();

    const requestToken = createKdsDeviceToken();
    const confirmationCode = randomInt(1_000_000).toString().padStart(6, "0");
    const requestExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.transaction(async tx => {
      await tx.update(staff).set({
        kdsTotpSecretEnc: encryptedTotp,
        kdsTotpPendingSecretEnc: null, kdsTotpPendingExpiresAt: null,
      }).where(eq(staff.staffId, member.staffId));
      await tx.insert(managedDevices).values({
        deviceName: deviceLabel, deviceType: deviceType as "POS" | "KDS", status: "PENDING",
        posEnabled: 0, kdsEnabled: 0, requestTokenHash: hashKdsDeviceToken(requestToken),
        confirmationCode, registeredByStaffId: member.staffId, requestedAt: new Date(), requestExpiresAt,
      });
      await tx.insert(auditLogs).values({
        staffId: member.staffId, actionType: "KDS_DEVICE_REQUESTED", entityType: "KDS_DEVICE",
        description: `type=${deviceType}; label=${deviceLabel}`,
      });
    });
    clearKdsEnrollmentAttempts(member.staffId, employeeId);
    return NextResponse.json({
      success: true, status: "PENDING", requestToken, confirmationCode,
      requestExpiresAt: requestExpiresAt.toISOString(), deviceName: deviceLabel, deviceType,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("KDS device enrollment completion failed", error);
    return NextResponse.json({ success: false, message: "Could not register this device." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
