import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminSecuritySettings, auditLogs } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminAccess, requireOwnerSecurityAccess } from "@/lib/admin-auth";
import { hashSecurityPassword, isValidSecurityPassword } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/kds-device";

export async function GET() {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false }, { status: 401 });
  const denied = await requireOwnerSecurityAccess(); if (denied) return denied;
  try {
    const [settings] = await db.select({ enabled: adminSecuritySettings.deviceRegistrationPasswordEnabled }).from(adminSecuritySettings).where(eq(adminSecuritySettings.settingsId, 1)).limit(1);
    if (!settings) return Response.json({ success: false }, { status: 503 });
    return Response.json({ success: true, enabled: settings.enabled === 1 }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ success: false, message: "기기 등록 설정을 불러오지 못했습니다." }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ success: false }, { status: 403 });
  const denied = await requireOwnerSecurityAccess(); if (denied) return denied;
  const writeDenied = await requireAdminAccess(); if (writeDenied) return writeDenied;
  const actor = await getCurrentAdminStaff(); if (!actor) return Response.json({ success: false }, { status: 401 });
  const body = await request.json().catch(() => null) as { enabled?: unknown; password?: unknown; confirm?: unknown } | null;
  if (typeof body?.enabled !== "boolean") return Response.json({ success: false, message: "설정 값을 확인해 주세요." }, { status: 400 });
  if (body.enabled && (typeof body.password !== "string" || typeof body.confirm !== "string" || !isValidSecurityPassword(body.password, 8) || body.password !== body.confirm)) {
    return Response.json({ success: false, message: "기기 등록 암호는 8자 이상이며 확인 값과 일치해야 합니다." }, { status: 400 });
  }
  try {
    const passwordHash = body.enabled ? await hashSecurityPassword(body.password as string, 8) : undefined;
    await db.transaction(async tx => {
      await tx.update(adminSecuritySettings).set({
        deviceRegistrationPasswordEnabled: body.enabled ? 1 : 0,
        ...(passwordHash ? { deviceRegistrationPasswordHash: passwordHash } : {}),
        updatedAt: new Date(), updatedByStaffId: actor.staffId,
      }).where(eq(adminSecuritySettings.settingsId, 1));
      await tx.insert(auditLogs).values({ staffId: actor.staffId, actionType: body.enabled ? "DEVICE_REGISTRATION_PASSWORD_ENABLED" : "DEVICE_REGISTRATION_PASSWORD_DISABLED", entityType: "ADMIN_SECURITY" });
    });
    return Response.json({ success: true });
  } catch (error) {
    const detail = error as { code?: string; cause?: { code?: string } };
    console.error("Device registration security update failed", { code: detail?.code ?? detail?.cause?.code });
    return Response.json({ success: false, message: "기기 등록 설정을 저장하지 못했습니다." }, { status: 503 });
  }
}
