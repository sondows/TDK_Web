import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, managedDevices } from "@/db/schema";
import { ADM_DEVICE_COOKIE, hashKdsDeviceToken, isSameOriginRequest, kdsCookieSecureForRequest, kdsDeviceCookieOptions } from "@/lib/kds-device";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ success: false }, { status: 403 });
  const cookieStore = await cookies();
  const token = cookieStore.get(ADM_DEVICE_COOKIE)?.value;
  if (!token) return NextResponse.json({ success: false }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const tokenHash = hashKdsDeviceToken(token);
  try {
    const revoked = await db.transaction(async tx => {
      const [device] = await tx.select({ deviceId: managedDevices.deviceId, deviceCode: managedDevices.deviceCode, expiresAt: managedDevices.expiresAt })
        .from(managedDevices).where(and(eq(managedDevices.deviceType, "ADM"), eq(managedDevices.tokenHash, tokenHash),
          eq(managedDevices.status, "APPROVED")))
        .limit(1).for("update");
      if (!device || !device.expiresAt || device.expiresAt.getTime() <= Date.now()) return false;
      await tx.update(managedDevices).set({ status: "REVOKED", tokenHash: null, requestTokenHash: null,
        revokedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(managedDevices.deviceId, device.deviceId), eq(managedDevices.tokenHash, tokenHash)));
      await tx.insert(auditLogs).values({ actionType: "DEVICE_SELF_REVOKED", entityType: "MANAGED_DEVICE",
        entityId: device.deviceId, description: "deviceCode=" + (device.deviceCode ?? "none") });
      return true;
    });
    if (!revoked) return NextResponse.json({ success: false }, { status: 403, headers: { "Cache-Control": "no-store" } });
    const response = NextResponse.json({ success: true, status: "UNREGISTERED" }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(ADM_DEVICE_COOKIE, "", { ...kdsDeviceCookieOptions, secure: kdsCookieSecureForRequest(request), maxAge: 0 });
    return response;
  } catch (error) {
    const detail = error as { name?: string; code?: string };
    console.error("ADM device self-revocation failed", { name: detail?.name, code: detail?.code });
    return NextResponse.json({ success: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
