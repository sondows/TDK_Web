import { and, eq, or } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { managedDevices } from "@/db/schema";
import { ADM_DEVICE_COOKIE, getCurrentDeviceRegistration, hashKdsDeviceToken, isSameOriginRequest,
  KDS_DEVICE_MAX_AGE_SECONDS, kdsCookieSecureForRequest, kdsDeviceCookieOptions } from "@/lib/kds-device";

const noStore = { "Cache-Control": "no-store" };

function clearCookie(response: NextResponse, request: Request) {
  response.cookies.set(ADM_DEVICE_COOKIE, "", { ...kdsDeviceCookieOptions, secure: kdsCookieSecureForRequest(request), maxAge: 0 });
  return response;
}

export async function GET(request: Request) {
  try {
    const registration = await getCurrentDeviceRegistration(ADM_DEVICE_COOKIE, "ADM");
    const device = registration?.device;
    if (device?.status === "PENDING" && device.requestExpiresAt && device.requestExpiresAt.getTime() > Date.now()) {
      return NextResponse.json({ success: true, status: "PENDING", deviceName: device.deviceName, deviceType: "ADM",
        confirmationCode: device.confirmationCode, requestExpiresAt: device.requestExpiresAt.toISOString() }, { headers: noStore });
    }
    if (device?.status === "APPROVED" && device.expiresAt && device.expiresAt.getTime() > Date.now()) {
      return NextResponse.json({ success: true, status: "APPROVED", deviceName: device.deviceName, deviceType: "ADM",
        deviceCode: device.deviceCode, expiresAt: device.expiresAt.toISOString() }, { headers: noStore });
    }
    const response = NextResponse.json({ success: true, status: "UNREGISTERED" }, { headers: noStore });
    return (await cookies()).has(ADM_DEVICE_COOKIE) ? clearCookie(response, request) : response;
  } catch (error) {
    const detail = error as { name?: string; code?: string };
    console.error("ADM device registration lookup failed", { name: detail?.name, code: detail?.code });
    return NextResponse.json({ success: false, message: "기기 등록 상태를 확인하지 못했습니다." }, { status: 503, headers: noStore });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ success: false }, { status: 403 });
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  const token = (await cookies()).get(ADM_DEVICE_COOKIE)?.value ?? "";
  if (token.length < 32 || token.length > 100) return NextResponse.json({ success: false }, { status: 404, headers: noStore });
  try {
    const tokenHash = hashKdsDeviceToken(token);
    const result = await db.transaction(async tx => {
      const [device] = await tx.select({ deviceId: managedDevices.deviceId, deviceCode: managedDevices.deviceCode,
        status: managedDevices.status, deviceName: managedDevices.deviceName, requestExpiresAt: managedDevices.requestExpiresAt,
        tokenHash: managedDevices.tokenHash, expiresAt: managedDevices.expiresAt })
        .from(managedDevices).where(and(eq(managedDevices.deviceType, "ADM"), or(
          eq(managedDevices.requestTokenHash, tokenHash), eq(managedDevices.tokenHash, tokenHash))))
        .limit(1).for("update");
      if (!device) return { state: "NOT_FOUND" as const };
      if (body?.action === "cancel") {
        if (device.status !== "PENDING") return { state: "NOT_PENDING" as const };
        await tx.update(managedDevices).set({ status: "DENIED", confirmationCode: null, requestTokenHash: null,
          requestExpiresAt: null, updatedAt: new Date() }).where(eq(managedDevices.deviceId, device.deviceId));
        return { state: "CANCELLED" as const };
      }
      if (device.status === "PENDING" && device.requestExpiresAt && device.requestExpiresAt.getTime() <= Date.now()) {
        await tx.update(managedDevices).set({ status: "EXPIRED", confirmationCode: null, requestTokenHash: null, updatedAt: new Date() })
          .where(eq(managedDevices.deviceId, device.deviceId));
        return { state: "EXPIRED" as const };
      }
      if (device.status === "PENDING") return { state: "PENDING" as const };
      if (device.status === "DENIED" || device.status === "EXPIRED" || device.status === "REVOKED") {
        await tx.update(managedDevices).set({ requestTokenHash: null, updatedAt: new Date() }).where(eq(managedDevices.deviceId, device.deviceId));
        return { state: device.status as "DENIED" | "EXPIRED" | "REVOKED" };
      }
      if (device.status !== "APPROVED" || device.tokenHash !== tokenHash) return { state: "NOT_FOUND" as const };
      if (!device.expiresAt || device.expiresAt.getTime() <= Date.now()) {
        await tx.update(managedDevices).set({ status: "EXPIRED", updatedAt: new Date() }).where(eq(managedDevices.deviceId, device.deviceId));
        return { state: "EXPIRED" as const };
      }
      await tx.update(managedDevices).set({ requestTokenHash: null, requestExpiresAt: null, confirmationCode: null, updatedAt: new Date() })
        .where(and(eq(managedDevices.deviceId, device.deviceId), eq(managedDevices.status, "APPROVED"), eq(managedDevices.tokenHash, tokenHash)));
      return { state: "APPROVED" as const, deviceCode: device.deviceCode, deviceName: device.deviceName, expiresAt: device.expiresAt };
    });
    if (result.state === "NOT_FOUND") return NextResponse.json({ success: false }, { status: 404, headers: noStore });
    if (result.state !== "APPROVED") {
      const response = NextResponse.json({ success: true, status: result.state }, { headers: noStore });
      return result.state === "PENDING" ? response : clearCookie(response, request);
    }
    const response = NextResponse.json({ success: true, status: "APPROVED", deviceName: result.deviceName,
      deviceType: "ADM", deviceCode: result.deviceCode, expiresAt: result.expiresAt.toISOString() }, { headers: noStore });
    response.cookies.set(ADM_DEVICE_COOKIE, token, { ...kdsDeviceCookieOptions, secure: kdsCookieSecureForRequest(request), maxAge: KDS_DEVICE_MAX_AGE_SECONDS });
    return response;
  } catch (error) {
    const detail = error as { name?: string; code?: string };
    console.error("ADM device approval status update failed", { name: detail?.name, code: detail?.code });
    return NextResponse.json({ success: false }, { status: 503, headers: noStore });
  }
}
