import { and, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/db";
import { managedDevices } from "@/db/schema";
import {
  hashKdsDeviceToken, KDS_DEVICE_COOKIE, KDS_DEVICE_MAX_AGE_SECONDS,
  getCurrentDeviceRegistration, kdsCookieSecureForRequest, kdsDeviceCookieOptions, isSameOriginRequest,
} from "@/lib/kds-device";

const noStore = { "Cache-Control": "no-store" };

function clearDeviceCookie(response: NextResponse, request: Request) {
  response.cookies.set(KDS_DEVICE_COOKIE, "", {
    ...kdsDeviceCookieOptions, secure: kdsCookieSecureForRequest(request), maxAge: 0,
  });
  return response;
}

export async function GET(request: Request) {
  try {
    const registration = await getCurrentDeviceRegistration();
    const device = registration?.device;
    if (device?.status === "PENDING" && device.requestExpiresAt && device.requestExpiresAt.getTime() > Date.now()) {
      return NextResponse.json({
        success: true, status: "PENDING", deviceName: device.deviceName,
        deviceType: device.deviceType, confirmationCode: device.confirmationCode,
        requestExpiresAt: device.requestExpiresAt.toISOString(),
      }, { headers: noStore });
    }
    if (device?.status === "APPROVED" && device.expiresAt && device.expiresAt.getTime() > Date.now()) {
      return NextResponse.json({
        success: true, status: "APPROVED", deviceName: device.deviceName,
        deviceType: device.deviceType, deviceCode: device.deviceCode,
        kdsEnabled: device.kdsEnabled === 1,
        expiresAt: device.expiresAt.toISOString(),
      }, { headers: noStore });
    }
    const response = NextResponse.json({ success: true, status: "UNREGISTERED" }, { headers: noStore });
    return (await cookies()).has(KDS_DEVICE_COOKIE) ? clearDeviceCookie(response, request) : response;
  } catch (error) {
    const detail = error as { name?: string; code?: string };
    console.error("Device registration lookup failed", { name: detail?.name, code: detail?.code });
    return NextResponse.json({ success: false, message: "Could not check device registration." }, { status: 503, headers: noStore });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ success: false }, { status: 403 });
  const body = await request.json().catch(() => null) as { requestToken?: unknown; action?: unknown } | null;
  const requestToken = typeof body?.requestToken === "string" ? body.requestToken : (await cookies()).get(KDS_DEVICE_COOKIE)?.value ?? "";
  if (requestToken.length < 32 || requestToken.length > 100) {
    return NextResponse.json({ success: false, message: "Registration request not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const requestHash = hashKdsDeviceToken(requestToken);
    const result = await db.transaction(async tx => {
      const [device] = await tx.select({
        deviceId: managedDevices.deviceId, deviceCode: managedDevices.deviceCode, status: managedDevices.status,
        deviceName: managedDevices.deviceName, requestExpiresAt: managedDevices.requestExpiresAt,
        deviceType: managedDevices.deviceType, tokenHash: managedDevices.tokenHash,
        expiresAt: managedDevices.expiresAt,
      }).from(managedDevices).where(or(
        eq(managedDevices.requestTokenHash, requestHash), eq(managedDevices.tokenHash, requestHash),
      )).limit(1).for("update");
      if (!device) return { status: 404 as const };
      if (body?.action === "cancel") {
        if (device.status !== "PENDING") return { status: 409 as const };
        await tx.update(managedDevices).set({
          status: "DENIED", requestTokenHash: null, confirmationCode: null, updatedAt: new Date(),
        }).where(eq(managedDevices.deviceId, device.deviceId));
        return { status: 200 as const, state: "CANCELLED" as const };
      }
      if (device.status === "PENDING" && device.requestExpiresAt && device.requestExpiresAt.getTime() <= Date.now()) {
        await tx.update(managedDevices).set({ status: "EXPIRED", confirmationCode: null, updatedAt: new Date() })
          .where(eq(managedDevices.deviceId, device.deviceId));
        return { status: 410 as const };
      }
      if (device.status === "PENDING") return { status: 200 as const, state: "PENDING" as const };
      if (device.status === "DENIED" || device.status === "EXPIRED") {
        await tx.update(managedDevices).set({ requestTokenHash: null, updatedAt: new Date() }).where(eq(managedDevices.deviceId, device.deviceId));
        return { status: 200 as const, state: device.status };
      }
      if (device.status !== "APPROVED" || device.tokenHash !== requestHash) return { status: 404 as const };
      if (!device.expiresAt || device.expiresAt.getTime() <= Date.now()) {
        await tx.update(managedDevices).set({ status: "EXPIRED", updatedAt: new Date() }).where(eq(managedDevices.deviceId, device.deviceId));
        return { status: 410 as const };
      }
      await tx.update(managedDevices).set({
        requestTokenHash: null, requestExpiresAt: null, confirmationCode: null,
        updatedAt: new Date(),
      }).where(and(
        eq(managedDevices.deviceId, device.deviceId), eq(managedDevices.status, "APPROVED"),
        eq(managedDevices.tokenHash, requestHash),
      ));
      return { status: 200 as const, state: "APPROVED" as const, deviceId: device.deviceId, deviceCode: device.deviceCode, deviceName: device.deviceName, deviceType: device.deviceType, expiresAt: device.expiresAt };
    });
    if (result.status === 404) return NextResponse.json({ success: false, message: "Registration request expired or not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    if (result.status === 410) return NextResponse.json({ success: true, status: "EXPIRED" }, { status: 200, headers: { "Cache-Control": "no-store" } });
    if (result.status === 409) return NextResponse.json({ success: false, message: "This request is no longer pending." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    if (result.state === "PENDING" || result.state === "DENIED" || result.state === "EXPIRED" || result.state === "CANCELLED") {
      const response = NextResponse.json({ success: true, status: result.state }, { headers: noStore });
      return result.state === "CANCELLED" || result.state === "DENIED" || result.state === "EXPIRED"
        ? clearDeviceCookie(response, request) : response;
    }
    if (result.state !== "APPROVED") {
      return NextResponse.json({ success: false, message: "Registration request not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    const response = NextResponse.json({
      success: true, status: "APPROVED", deviceId: result.deviceId,
      deviceCode: result.deviceCode, deviceName: result.deviceName, deviceType: result.deviceType, expiresAt: result.expiresAt.toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(KDS_DEVICE_COOKIE, requestToken, {
      ...kdsDeviceCookieOptions, secure: kdsCookieSecureForRequest(request),
      maxAge: KDS_DEVICE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    const detail = error as { name?: string; code?: string };
    console.error("Device request status lookup failed", { name: detail?.name, code: detail?.code });
    return NextResponse.json({ success: false, message: "Could not check device approval status." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
