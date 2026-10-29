import { and, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, managedDevices, staffSessions } from "@/db/schema";
import { hashSessionToken } from "@/lib/auth";
import { KDS_SESSION_COOKIE_NAME, kdsSessionCookieOptions } from "@/lib/kds-auth";
import {
  hashKdsDeviceToken, isSameOriginRequest, KDS_DEVICE_COOKIE,
  kdsCookieSecureForRequest, kdsDeviceCookieOptions,
} from "@/lib/kds-device";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ success: false }, { status: 403 });
  const cookieStore = await cookies();
  const deviceToken = cookieStore.get(KDS_DEVICE_COOKIE)?.value;
  if (!deviceToken) return NextResponse.json({ success: false }, { status: 403 });
  const deviceTokenHash = hashKdsDeviceToken(deviceToken);
  const sessionToken = cookieStore.get(KDS_SESSION_COOKIE_NAME)?.value;
  const now = new Date();

  try {
    const revoked = await db.transaction(async tx => {
      const [device] = await tx.select({ deviceId: managedDevices.deviceId, deviceCode: managedDevices.deviceCode })
        .from(managedDevices).where(and(
          eq(managedDevices.tokenHash, deviceTokenHash),
          eq(managedDevices.status, "APPROVED"),
          sql`${managedDevices.expiresAt} > NOW()`,
        )).limit(1).for("update");
      if (!device) return false;

      await tx.update(managedDevices).set({
        status: "REVOKED", tokenHash: null, requestTokenHash: null,
        revokedAt: now, updatedAt: now,
      }).where(and(eq(managedDevices.deviceId, device.deviceId), eq(managedDevices.tokenHash, deviceTokenHash)));
      await tx.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: now }).where(and(
        eq(staffSessions.managedDeviceId, device.deviceId), eq(staffSessions.sessionType, "KDS"),
        eq(staffSessions.status, "ACTIVE"),
      ));
      if (sessionToken) {
        await tx.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: now }).where(and(
          eq(staffSessions.sessionTokenHash, hashSessionToken(sessionToken)),
          eq(staffSessions.sessionType, "KDS"), eq(staffSessions.status, "ACTIVE"),
        ));
      }
      await tx.insert(auditLogs).values({
        actionType: "DEVICE_SELF_REVOKED", entityType: "MANAGED_DEVICE", entityId: device.deviceId,
        description: `deviceCode=${device.deviceCode ?? "none"}`,
      });
      return true;
    });
    if (!revoked) return NextResponse.json({ success: false }, { status: 403, headers: { "Cache-Control": "no-store" } });

    const response = NextResponse.json({ success: true, status: "UNREGISTERED" }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(KDS_DEVICE_COOKIE, "", {
      ...kdsDeviceCookieOptions, secure: kdsCookieSecureForRequest(request), maxAge: 0,
    });
    response.cookies.set(KDS_SESSION_COOKIE_NAME, "", {
      ...kdsSessionCookieOptions, secure: kdsCookieSecureForRequest(request), maxAge: 0,
    });
    return response;
  } catch (error) {
    const detail = error as { name?: string; code?: string };
    console.error("Device self-revocation failed", { name: detail?.name, code: detail?.code });
    return NextResponse.json({ success: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
