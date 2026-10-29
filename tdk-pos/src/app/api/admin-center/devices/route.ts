import { and, eq, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, managedDevices, staffSessions } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminAccess, requireOwnerSecurityAccess } from "@/lib/admin-auth";
import { isSameOriginRequest } from "@/lib/kds-device";
import { isManagedDeviceType, managedDeviceCode } from "@/lib/managed-device-types";

function deviceRegistryFailure(error: unknown, operation: string) {
  const detail = error as { name?: string; code?: string; message?: string; sqlMessage?: string; cause?: { code?: string; message?: string; sqlMessage?: string } };
  const code = detail?.code ?? detail?.cause?.code;
  const databaseMessage = detail?.sqlMessage ?? detail?.cause?.sqlMessage ?? detail?.message ?? detail?.cause?.message ?? "";
  console.error(`Admin device registry ${operation} failed`, { name: detail?.name, code });
  if (code === "ER_NO_SUCH_TABLE" && /managed_devices/i.test(databaseMessage)) return Response.json({
    success: false, code: "DEVICE_REGISTRY_TABLE_MISSING",
    message: "연결 DB에 managed_devices 테이블이 없습니다. 기본 기기관리 SQL 적용 여부를 확인해 주세요.",
  }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (code === "ER_BAD_FIELD_ERROR" && /(adm_enabled|hos_enabled)/i.test(databaseMessage)) return Response.json({
    success: false, code: "DEVICE_REGISTRY_COLUMNS_MISSING",
    message: "managed_devices에 adm_enabled 또는 hos_enabled 컬럼이 없습니다. managed_devices_add_adm_hos.sql 적용 여부를 확인해 주세요.",
  }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (["ER_TRUNCATED_WRONG_VALUE_FOR_FIELD", "WARN_DATA_TRUNCATED"].includes(code ?? "") && /device_type/i.test(databaseMessage)) return Response.json({
    success: false, code: "DEVICE_TYPE_ENUM_OUTDATED",
    message: "managed_devices.device_type ENUM에 ADM·HOS가 없습니다. managed_devices_add_adm_hos.sql 적용 여부를 확인해 주세요.",
  }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR", "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD", "WARN_DATA_TRUNCATED"].includes(code ?? "")) return Response.json({
    success: false, code: "DEVICE_REGISTRY_SCHEMA_MISMATCH",
    message: "기기관리 DB 스키마가 현재 코드와 일치하지 않습니다. 기본 기기관리 SQL과 managed_devices_add_adm_hos.sql 적용 여부를 확인해 주세요.",
  }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (["ER_ACCESS_DENIED_ERROR", "ECONNREFUSED", "ETIMEDOUT", "PROTOCOL_CONNECTION_LOST"].includes(code ?? "")) return Response.json({
    success: false,
    code: "DEVICE_REGISTRY_DB_UNAVAILABLE",
    message: "기기관리 DB에 연결할 수 없습니다. 서버의 DB 주소와 계정 설정을 확인해 주세요.",
  }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return Response.json({
    success: false,
    code: "DEVICE_REGISTRY_UNAVAILABLE",
    message: "기기관리 DB 처리에 실패했습니다. 서버 로그에서 원인을 확인해 주세요.",
  }, { status: 503, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  try {
    if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
    const ownerDenied = await requireOwnerSecurityAccess(); if (ownerDenied) return ownerDenied;
    const now = new Date();
    await db.update(managedDevices).set({ status: "EXPIRED", confirmationCode: null, updatedAt: now }).where(and(
      eq(managedDevices.status, "PENDING"), lte(managedDevices.requestExpiresAt, now),
    ));
    await db.update(managedDevices).set({ status: "EXPIRED", updatedAt: now }).where(and(
      eq(managedDevices.status, "APPROVED"), lte(managedDevices.expiresAt, now),
    ));
    const devices = await db.select({
      deviceId: managedDevices.deviceId,
      deviceCode: managedDevices.deviceCode,
      deviceName: managedDevices.deviceName,
      deviceType: managedDevices.deviceType,
      status: managedDevices.status,
      posEnabled: managedDevices.posEnabled,
      admEnabled: managedDevices.admEnabled,
      kdsEnabled: managedDevices.kdsEnabled,
      hosEnabled: managedDevices.hosEnabled,
      confirmationCode: managedDevices.confirmationCode,
      registeredByStaffId: managedDevices.registeredByStaffId,
      requestedAt: managedDevices.requestedAt,
      requestExpiresAt: managedDevices.requestExpiresAt,
      approvedAt: managedDevices.approvedAt,
      createdAt: managedDevices.createdAt,
      lastUsedAt: managedDevices.lastUsedAt,
      expiresAt: managedDevices.expiresAt,
      revokedAt: managedDevices.revokedAt,
    }).from(managedDevices).orderBy(managedDevices.status, managedDevices.requestedAt);
    return Response.json({ success: true, devices }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return deviceRegistryFailure(error, "list");
  }
}

export async function POST(request: Request) {
  let actor: Awaited<ReturnType<typeof getCurrentAdminStaff>>;
  try {
    const denied = await requireAdminAccess();
    if (denied) return denied;
    actor = await getCurrentAdminStaff();
    if (!actor) return Response.json({ success: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
    const ownerDenied = await requireOwnerSecurityAccess(); if (ownerDenied) return ownerDenied;
  } catch (error) {
    return deviceRegistryFailure(error, "authorization");
  }
  if (!isSameOriginRequest(request)) return Response.json({ success: false }, { status: 403 });
  const body = await request.json().catch(() => null) as {
    action?: unknown; deviceId?: unknown; deviceName?: unknown; deviceType?: unknown;
    posEnabled?: unknown; admEnabled?: unknown; kdsEnabled?: unknown; hosEnabled?: unknown;
  } | null;
  const action = body?.action;
  const deviceId = Number(body?.deviceId);
  if (!["approve", "deny", "update", "revoke", "delete"].includes(String(action)) ||
      !Number.isSafeInteger(deviceId) || deviceId <= 0) {
    return Response.json({ success: false, message: "Invalid device operation." }, { status: 400 });
  }
  if ((action === "approve" || action === "update") &&
      (typeof body?.deviceName !== "string" || !body.deviceName.trim() || body.deviceName.trim().length > 120 ||
       (body.deviceType !== undefined && !isManagedDeviceType(body.deviceType)) ||
       typeof body.posEnabled !== "boolean" || typeof body.kdsEnabled !== "boolean" ||
       (body.admEnabled !== undefined && typeof body.admEnabled !== "boolean") ||
       (body.hosEnabled !== undefined && typeof body.hosEnabled !== "boolean"))) {
    return Response.json({ success: false, message: "Set a valid device name, type and permissions." }, { status: 400 });
  }
  const now = new Date();
  try {
    const result = await db.transaction(async tx => {
      const [device] = await tx.select({
        deviceId: managedDevices.deviceId, deviceCode: managedDevices.deviceCode,
        deviceType: managedDevices.deviceType, deviceName: managedDevices.deviceName,
        admEnabled: managedDevices.admEnabled, hosEnabled: managedDevices.hosEnabled,
        status: managedDevices.status, requestExpiresAt: managedDevices.requestExpiresAt,
        requestTokenHash: managedDevices.requestTokenHash,
      }).from(managedDevices).where(eq(managedDevices.deviceId, deviceId)).limit(1).for("update");
      if (!device) return { status: 404, message: "Device not found." };

      if (action === "approve" || action === "deny") {
        if (device.status !== "PENDING") return { status: 409, message: "This request is no longer pending." };
        if (!device.requestExpiresAt || device.requestExpiresAt.getTime() <= now.getTime()) {
          await tx.update(managedDevices).set({ status: "EXPIRED", confirmationCode: null, updatedAt: now }).where(eq(managedDevices.deviceId, deviceId));
          return { status: 410, message: "This registration request expired." };
        }
        if (action === "deny") {
          await tx.update(managedDevices).set({ status: "DENIED", confirmationCode: null, requestExpiresAt: null, updatedAt: now }).where(eq(managedDevices.deviceId, deviceId));
          await tx.insert(auditLogs).values({ staffId: actor.staffId, actionType: "DEVICE_REQUEST_DENIED", entityType: "MANAGED_DEVICE", entityId: deviceId });
          return { status: 200, success: true };
        }
        const deviceType = isManagedDeviceType(body?.deviceType) ? body.deviceType : device.deviceType;
        const admEnabled = body?.admEnabled === undefined ? deviceType === "ADM" : body.admEnabled === true;
        const hosEnabled = body?.hosEnabled === undefined ? deviceType === "HOS" : body.hosEnabled === true;
        if (!body!.posEnabled && !body!.kdsEnabled && !admEnabled && !hosEnabled) {
          return { status: 400, message: "Enable at least one permission." };
        }
        const deviceCode = managedDeviceCode(deviceType, device.deviceId);
        await tx.update(managedDevices).set({
          status: "APPROVED", deviceCode, deviceType, deviceName: (body!.deviceName as string).trim(),
          posEnabled: body!.posEnabled ? 1 : 0, admEnabled: admEnabled ? 1 : 0,
          kdsEnabled: body!.kdsEnabled ? 1 : 0, hosEnabled: hosEnabled ? 1 : 0,
          tokenHash: device.requestTokenHash, expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
          requestExpiresAt: null, confirmationCode: null, approvedAt: now, updatedAt: now,
        }).where(eq(managedDevices.deviceId, deviceId));
        await tx.insert(auditLogs).values({
          staffId: actor.staffId, actionType: "DEVICE_REQUEST_APPROVED", entityType: "MANAGED_DEVICE",
          entityId: deviceId, description: `type=${deviceType}; code=${deviceCode}`,
        });
        return { status: 200, success: true, deviceCode };
      }

      if (action === "update") {
        if (device.status !== "APPROVED") return { status: 409, message: "Only approved devices can be edited." };
        const deviceType = isManagedDeviceType(body?.deviceType) ? body.deviceType : device.deviceType;
        const admEnabled = body?.admEnabled === undefined ? device.admEnabled : body.admEnabled ? 1 : 0;
        const hosEnabled = body?.hosEnabled === undefined ? device.hosEnabled : body.hosEnabled ? 1 : 0;
        const kdsEnabled = body!.kdsEnabled ? 1 : 0;
        const posEnabled = body!.posEnabled ? 1 : 0;
        if (!posEnabled && !admEnabled && !kdsEnabled && !hosEnabled) {
          return { status: 400, message: "Enable at least one permission." };
        }
        const deviceCode = deviceType === device.deviceType ? device.deviceCode : managedDeviceCode(deviceType, deviceId);
        await tx.update(managedDevices).set({
          deviceName: (body!.deviceName as string).trim(), deviceType, deviceCode,
          posEnabled, admEnabled, kdsEnabled, hosEnabled, updatedAt: now,
        }).where(eq(managedDevices.deviceId, deviceId));
        if (!kdsEnabled) await tx.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: now }).where(and(
          eq(staffSessions.managedDeviceId, deviceId), eq(staffSessions.sessionType, "KDS"), eq(staffSessions.status, "ACTIVE"),
        ));
        await tx.insert(auditLogs).values({ staffId: actor.staffId, actionType: "DEVICE_UPDATED", entityType: "MANAGED_DEVICE", entityId: deviceId });
        return { status: 200, success: true };
      }

      if (action === "revoke") {
        if (device.status !== "APPROVED") return { status: 409, message: "Only approved devices can be revoked." };
        await tx.update(managedDevices).set({ status: "REVOKED", revokedAt: now, updatedAt: now }).where(eq(managedDevices.deviceId, deviceId));
        await tx.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: now }).where(and(
          eq(staffSessions.managedDeviceId, deviceId), eq(staffSessions.status, "ACTIVE"), ne(staffSessions.sessionType, "ADMIN"),
        ));
        await tx.insert(auditLogs).values({ staffId: actor.staffId, actionType: "DEVICE_REVOKED", entityType: "MANAGED_DEVICE", entityId: deviceId });
        return { status: 200, success: true };
      }

      if (device.status === "PENDING") return { status: 409, message: "Deny a pending request instead of deleting it." };
      await tx.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: now }).where(and(
        eq(staffSessions.managedDeviceId, deviceId), eq(staffSessions.status, "ACTIVE"), ne(staffSessions.sessionType, "ADMIN"),
      ));
      await tx.delete(managedDevices).where(eq(managedDevices.deviceId, deviceId));
      await tx.insert(auditLogs).values({
        staffId: actor.staffId, actionType: "DEVICE_DELETED", entityType: "MANAGED_DEVICE",
        entityId: deviceId, description: `deviceCode=${device.deviceCode ?? "none"}`,
      });
      return { status: 200, success: true };
    });
    return Response.json(result, { status: result.status });
  } catch (error) {
    return deviceRegistryFailure(error, `operation:${action}`);
  }
}
