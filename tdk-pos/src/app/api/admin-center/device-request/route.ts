import { randomInt } from "crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { adminSecuritySettings, auditLogs, managedDevices } from "@/db/schema";
import { verifySecurityPassword } from "@/lib/auth";
import {
  ADM_DEVICE_COOKIE, createKdsDeviceToken, getCurrentDeviceRegistration, hashKdsDeviceToken,
  isSameOriginRequest, KDS_DEVICE_MAX_AGE_SECONDS, kdsCookieSecureForRequest, kdsDeviceCookieOptions,
  reserveKdsIpAttempt,
} from "@/lib/kds-device";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ success: false }, { status: 403 });
  const body = await request.json().catch(() => null) as { deviceName?: unknown; registrationPassword?: unknown } | null;
  const deviceName = typeof body?.deviceName === "string" ? body.deviceName.trim() : "";
  if (!deviceName || deviceName.length > 120) return NextResponse.json({ success: false, message: "기기 이름을 입력해 주세요." }, { status: 400 });

  try {
    const existing = await getCurrentDeviceRegistration(ADM_DEVICE_COOKIE, "ADM");
    if (existing?.device.status === "APPROVED" && existing.device.expiresAt && existing.device.expiresAt.getTime() > Date.now()) {
      return NextResponse.json({ success: false, code: "DEVICE_ALREADY_REGISTERED" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (existing?.device.status === "PENDING" && existing.device.requestExpiresAt && existing.device.requestExpiresAt.getTime() > Date.now()) {
      return NextResponse.json({ success: true, status: "PENDING", confirmationCode: existing.device.confirmationCode,
        requestExpiresAt: existing.device.requestExpiresAt.toISOString(), deviceName: existing.device.deviceName,
        deviceType: "ADM" }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!await reserveKdsIpAttempt()) return NextResponse.json({ success: false, message: "등록 요청이 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
    const [security] = await db.select({ enabled: adminSecuritySettings.deviceRegistrationPasswordEnabled, passwordHash: adminSecuritySettings.deviceRegistrationPasswordHash })
      .from(adminSecuritySettings).where(eq(adminSecuritySettings.settingsId, 1)).limit(1);
    if (!security) return NextResponse.json({ success: false, message: "기기 등록을 일시적으로 사용할 수 없습니다." }, { status: 503 });
    if (security.enabled === 1 && (typeof body?.registrationPassword !== "string" || !(await verifySecurityPassword(body.registrationPassword, security.passwordHash)))) {
      return NextResponse.json({ success: false, code: "REGISTRATION_PASSWORD_INVALID", message: "기기 등록 암호를 확인해 주세요." }, { status: 403 });
    }

    const requestToken = createKdsDeviceToken();
    const now = new Date();
    const requestExpiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    const confirmationCode = randomInt(1_000_000).toString().padStart(6, "0");
    await db.transaction(async tx => {
      await tx.insert(managedDevices).values({ deviceName, deviceType: "ADM", status: "PENDING",
        posEnabled: 0, admEnabled: 0, kdsEnabled: 0, hosEnabled: 0,
        requestTokenHash: hashKdsDeviceToken(requestToken), confirmationCode, requestedAt: now, requestExpiresAt });
      await tx.insert(auditLogs).values({ actionType: "DEVICE_REQUESTED", entityType: "MANAGED_DEVICE", description: "type=ADM; name=" + deviceName });
    });
    const response = NextResponse.json({ success: true, status: "PENDING", confirmationCode, requestedAt: now.toISOString(),
      requestExpiresAt: requestExpiresAt.toISOString(), deviceName, deviceType: "ADM" }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(ADM_DEVICE_COOKIE, requestToken, { ...kdsDeviceCookieOptions,
      secure: kdsCookieSecureForRequest(request), maxAge: KDS_DEVICE_MAX_AGE_SECONDS });
    return response;
  } catch (error) {
    const detail = error as { name?: string; code?: string };
    console.error("ADM device registration request failed", { name: detail?.name, code: detail?.code });
    return NextResponse.json({ success: false, message: "기기 등록 요청을 처리하지 못했습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
