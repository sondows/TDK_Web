import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, managedDevices, staffSessions } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminAccess, requireOwnerSecurityAccess } from "@/lib/admin-auth";
import { isSameOriginRequest } from "@/lib/kds-device";

export async function GET(_request: Request, { params }: { params: Promise<{ staffId: string }> }) {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false }, { status: 401 });
  const ownerDenied = await requireOwnerSecurityAccess(); if (ownerDenied) return ownerDenied;
  const staffId = Number((await params).staffId);
  if (!Number.isSafeInteger(staffId) || staffId <= 0) return Response.json({ success: false }, { status: 404 });
  const devices = await db.select({
    deviceId: managedDevices.deviceId, label: managedDevices.deviceName,
    createdAt: managedDevices.createdAt, lastUsedAt: managedDevices.lastUsedAt,
    expiresAt: managedDevices.expiresAt, revokedAt: managedDevices.revokedAt,
    status: managedDevices.status,
  }).from(managedDevices).where(and(
    eq(managedDevices.registeredByStaffId, staffId), eq(managedDevices.deviceType, "KDS"),
  )).orderBy(managedDevices.createdAt);
  return Response.json({ success: true, devices }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ staffId: string }> }) {
  const denied = await requireAdminAccess();
  if (denied) return denied;
  const actor = await getCurrentAdminStaff();
  if (!actor) return Response.json({ success: false }, { status: 401 });
  const ownerDenied = await requireOwnerSecurityAccess(); if (ownerDenied) return ownerDenied;
  if (!isSameOriginRequest(request)) return Response.json({ success: false }, { status: 403 });
  const staffId = Number((await params).staffId);
  if (!Number.isSafeInteger(staffId) || staffId <= 0) return Response.json({ success: false }, { status: 404 });
  const body = await request.json().catch(() => null) as { deviceId?: unknown } | null;
  const deviceId = Number(body?.deviceId);
  if (!Number.isSafeInteger(deviceId) || deviceId <= 0) return Response.json({ success: false, message: "Choose a device to revoke." }, { status: 400 });
  const now = new Date();
  await db.transaction(async tx => {
    await tx.update(managedDevices).set({ status: "REVOKED", revokedAt: now, updatedAt: now }).where(and(
      eq(managedDevices.registeredByStaffId, staffId), eq(managedDevices.deviceType, "KDS"),
      eq(managedDevices.deviceId, deviceId), eq(managedDevices.status, "APPROVED"),
    ));
    await tx.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: now }).where(and(
      eq(staffSessions.staffId, staffId), eq(staffSessions.managedDeviceId, deviceId), eq(staffSessions.sessionType, "KDS"), eq(staffSessions.status, "ACTIVE"),
    ));
    await tx.insert(auditLogs).values({
      staffId: actor.staffId, actionType: "KDS_DEVICE_REVOKED", entityType: "KDS_DEVICE",
      entityId: deviceId, description: `staffId=${staffId}`,
    });
  });
  return Response.json({ success: true });
}
