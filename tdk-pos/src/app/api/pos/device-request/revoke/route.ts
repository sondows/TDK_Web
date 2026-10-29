import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, managedDevices, staffSessions } from "@/db/schema";
import { hashSessionToken, SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth";
import { hashKdsDeviceToken, isSameOriginRequest, kdsCookieSecureForRequest, kdsDeviceCookieOptions, POS_DEVICE_COOKIE } from "@/lib/kds-device";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ success: false }, { status: 403 });
  const cookieStore = await cookies();
  const token = cookieStore.get(POS_DEVICE_COOKIE)?.value;
  if (!token) return NextResponse.json({ success: false }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const tokenHash = hashKdsDeviceToken(token);
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const now = new Date();
  try {
    const revoked = await db.transaction(async tx => {
      const [device] = await tx.select({ deviceId: managedDevices.deviceId, deviceCode: managedDevices.deviceCode,
        expiresAt: managedDevices.expiresAt }).from(managedDevices).where(and(
        eq(managedDevices.deviceType, "POS"), eq(managedDevices.tokenHash, tokenHash), eq(managedDevices.status, "APPROVED"),
      )).limit(1).for("update");
      if (!device || !device.expiresAt || device.expiresAt.getTime() <= now.getTime()) return false;
      await tx.update(managedDevices).set({ status: "REVOKED", tokenHash: null, requestTokenHash: null,
        revokedAt: now, updatedAt: now }).where(and(eq(managedDevices.deviceId, device.deviceId), eq(managedDevices.tokenHash, tokenHash)));
      await tx.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: now }).where(and(
        eq(staffSessions.managedDeviceId, device.deviceId), eq(staffSessions.sessionType, "POS"), eq(staffSessions.status, "ACTIVE"),
      ));
      if (sessionToken) await tx.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: now }).where(and(
        eq(staffSessions.sessionTokenHash, hashSessionToken(sessionToken)), eq(staffSessions.sessionType, "POS"),
        eq(staffSessions.status, "ACTIVE"),
      ));
      await tx.insert(auditLogs).values({ actionType: "DEVICE_SELF_REVOKED", entityType: "MANAGED_DEVICE",
        entityId: device.deviceId, description: "deviceCode=" + (device.deviceCode ?? "none") });
      return true;
    });
    if (!revoked) return NextResponse.json({ success: false }, { status: 403, headers: { "Cache-Control": "no-store" } });
    const response = NextResponse.json({ success: true, status: "UNREGISTERED" }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(POS_DEVICE_COOKIE, "", { ...kdsDeviceCookieOptions, secure: kdsCookieSecureForRequest(request), maxAge: 0 });
    response.cookies.set(SESSION_COOKIE_NAME, "", { ...sessionCookieOptions, secure: kdsCookieSecureForRequest(request), maxAge: 0 });
    return response;
  } catch (error) {
    const detail = error as { name?: string; code?: string };
    console.error("POS device self-revocation failed", { name: detail?.name, code: detail?.code });
    return NextResponse.json({ success: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
