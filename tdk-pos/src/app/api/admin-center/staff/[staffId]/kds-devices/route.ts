import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { kdsTrustedDevices, staffSessions } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminWrite } from "@/lib/admin-auth";

export async function GET(_request: Request, { params }: { params: Promise<{ staffId: string }> }) {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false }, { status: 401 });
  const staffId = Number((await params).staffId);
  if (!Number.isSafeInteger(staffId) || staffId <= 0) return Response.json({ success: false }, { status: 404 });
  const devices = await db.select({
    deviceId: kdsTrustedDevices.deviceId, label: kdsTrustedDevices.deviceLabel,
    createdAt: kdsTrustedDevices.createdAt, lastUsedAt: kdsTrustedDevices.lastUsedAt,
    expiresAt: kdsTrustedDevices.expiresAt, revokedAt: kdsTrustedDevices.revokedAt,
  }).from(kdsTrustedDevices).where(eq(kdsTrustedDevices.staffId, staffId)).orderBy(kdsTrustedDevices.createdAt);
  return Response.json({ success: true, devices }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ staffId: string }> }) {
  const denied = await requireAdminWrite();
  if (denied) return denied;
  if (!await getCurrentAdminStaff()) return Response.json({ success: false }, { status: 401 });
  const staffId = Number((await params).staffId);
  if (!Number.isSafeInteger(staffId) || staffId <= 0) return Response.json({ success: false }, { status: 404 });
  const body = await request.json().catch(() => null) as { deviceId?: unknown } | null;
  const deviceId = Number(body?.deviceId);
  if (!Number.isSafeInteger(deviceId) || deviceId <= 0) return Response.json({ success: false, message: "Choose a device to revoke." }, { status: 400 });
  const now = new Date();
  await db.transaction(async tx => {
    await tx.update(kdsTrustedDevices).set({ revokedAt: now }).where(and(
      eq(kdsTrustedDevices.staffId, staffId), eq(kdsTrustedDevices.deviceId, deviceId), isNull(kdsTrustedDevices.revokedAt),
    ));
    await tx.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: now }).where(and(
      eq(staffSessions.staffId, staffId), eq(staffSessions.deviceId, deviceId), eq(staffSessions.sessionType, "KDS"), eq(staffSessions.status, "ACTIVE"),
    ));
  });
  return Response.json({ success: true });
}
