import { randomInt } from "crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { adminSecuritySettings, auditLogs, managedDevices } from "@/db/schema";
import { verifySecurityPassword } from "@/lib/auth";
import {
  createKdsDeviceToken, getCurrentDeviceRegistration, hashKdsDeviceToken,
  isSameOriginRequest, KDS_DEVICE_COOKIE, KDS_DEVICE_MAX_AGE_SECONDS,
  kdsCookieSecureForRequest, kdsDeviceCookieOptions, reserveKdsIpAttempt,
} from "@/lib/kds-device";
import { isManagedDeviceType } from "@/lib/managed-device-types";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ success: false, message: "Request origin could not be verified." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { deviceName?: unknown; deviceType?: unknown; registrationPassword?: unknown } | null;
  const deviceName = typeof body?.deviceName === "string" ? body.deviceName.trim() : "";
  const deviceType = body?.deviceType;
  if (!deviceName || deviceName.length > 120 || !isManagedDeviceType(deviceType)) {
    return NextResponse.json({ success: false, message: "Enter a device name and choose POS, ADM, KDS or HOS." }, { status: 400 });
  }

  try {
    const existing = await getCurrentDeviceRegistration();
    if (existing?.device.status === "APPROVED" && existing.device.expiresAt && existing.device.expiresAt.getTime() > Date.now()) {
      return NextResponse.json({ success: false, code: "DEVICE_ALREADY_REGISTERED" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (existing?.device.status === "PENDING" && existing.device.requestExpiresAt && existing.device.requestExpiresAt.getTime() > Date.now()) {
      return NextResponse.json({
        success: true, status: "PENDING", requestToken: existing.token,
        confirmationCode: existing.device.confirmationCode,
        requestExpiresAt: existing.device.requestExpiresAt.toISOString(),
        deviceName: existing.device.deviceName, deviceType: existing.device.deviceType,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!await reserveKdsIpAttempt()) {
      return NextResponse.json({ success: false, message: "Too many registration requests. Try again in 15 minutes." }, { status: 429 });
    }
    const [security] = await db.select({ enabled: adminSecuritySettings.deviceRegistrationPasswordEnabled, passwordHash: adminSecuritySettings.deviceRegistrationPasswordHash })
      .from(adminSecuritySettings).where(eq(adminSecuritySettings.settingsId, 1)).limit(1);
    if (!security) return NextResponse.json({ success: false, message: "Device registration is temporarily unavailable." }, { status: 503 });
    if (security.enabled === 1 && (typeof body?.registrationPassword !== "string" || !(await verifySecurityPassword(body.registrationPassword, security.passwordHash)))) {
      return NextResponse.json({ success: false, code: "REGISTRATION_PASSWORD_INVALID", message: "기기 등록 암호를 확인해 주세요." }, { status: 403 });
    }
    const requestToken = createKdsDeviceToken();
    const confirmationCode = randomInt(1_000_000).toString().padStart(6, "0");
    const requestedAt = new Date();
    const requestExpiresAt = new Date(requestedAt.getTime() + 10 * 60 * 1000);
    await db.transaction(async tx => {
      await tx.insert(managedDevices).values({
        deviceName, deviceType, status: "PENDING",
        posEnabled: 0, admEnabled: 0, kdsEnabled: 0, hosEnabled: 0,
        requestTokenHash: hashKdsDeviceToken(requestToken),
        confirmationCode, requestedAt, requestExpiresAt,
      });
      await tx.insert(auditLogs).values({
        actionType: "DEVICE_REQUESTED", entityType: "MANAGED_DEVICE",
        description: `type=${deviceType}; name=${deviceName}`,
      });
    });
    const response = NextResponse.json({
      success: true, status: "PENDING", requestToken, confirmationCode,
      requestedAt: requestedAt.toISOString(), requestExpiresAt: requestExpiresAt.toISOString(),
      deviceName, deviceType,
    }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(KDS_DEVICE_COOKIE, requestToken, {
      ...kdsDeviceCookieOptions, secure: kdsCookieSecureForRequest(request),
      maxAge: KDS_DEVICE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    const detail = error as { name?: string; code?: string };
    console.error("Device registration request failed", { name: detail?.name, code: detail?.code });
    return NextResponse.json({ success: false, message: "Could not submit the device registration request." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
