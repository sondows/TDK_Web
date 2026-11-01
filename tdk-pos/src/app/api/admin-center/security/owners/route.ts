import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { adminSecurityOwners, adminSecuritySettings, auditLogs, staff } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminAccess, requireOwnerSecurityAccess } from "@/lib/admin-auth";
import { canAddSecurityOwner, canRemoveSecurityOwner } from "@/lib/admin-security-owners";
import { isSameOriginRequest } from "@/lib/kds-device";

export async function GET() {
  const denied = await requireOwnerSecurityAccess();
  if (denied) return denied;
  try {
    const [owners, employees] = await Promise.all([
      db.select({ staffId: adminSecurityOwners.staffId, masterPasswordHash: staff.securityPasswordHash, name: staff.name, loginId: staff.adminLoginId })
        .from(adminSecurityOwners).innerJoin(staff, eq(staff.staffId, adminSecurityOwners.staffId)),
      db.select({ staffId: staff.staffId, name: staff.name, loginId: staff.adminLoginId })
        .from(staff).where(and(eq(staff.isActive, 1), eq(staff.adminEnabled, 1), ne(staff.staffCode, "000"))),
    ]);
    return Response.json({ success: true, owners: owners.map(({ masterPasswordHash, ...owner }) => ({ ...owner, status: masterPasswordHash ? "ACTIVE" : "SETUP_PENDING" })), employees });
  } catch {
    return Response.json({ success: false, message: "최고관리자 목록을 불러오지 못했습니다." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ success: false }, { status: 403 });
  const denied = await requireOwnerSecurityAccess();
  if (denied) return denied;
  const writeDenied = await requireAdminAccess();
  if (writeDenied) return writeDenied;
  const actor = await getCurrentAdminStaff();
  if (!actor) return Response.json({ success: false }, { status: 401 });
  const body = await request.json().catch(() => null) as { action?: unknown; staffId?: unknown } | null;
  const id = body?.staffId;
  if (!body || !["add", "revoke"].includes(String(body.action)) || !Number.isSafeInteger(id) || Number(id) <= 0) {
    return Response.json({ success: false, message: "요청 내용을 확인해 주세요." }, { status: 400 });
  }
  const targetId = Number(id);
  try {
    return await db.transaction(async tx => {
      // Serialize membership changes and last-owner checks on the existing singleton row.
      const [settings] = await tx.select({ id: adminSecuritySettings.settingsId }).from(adminSecuritySettings)
        .where(eq(adminSecuritySettings.settingsId, 1)).limit(1).for("update");
      if (!settings) return Response.json({ success: false, message: "보안 설정이 없습니다." }, { status: 503 });
      const [actorOwner] = await tx.select({ staffId: adminSecurityOwners.staffId }).from(adminSecurityOwners)
        .where(eq(adminSecurityOwners.staffId, actor.staffId)).limit(1);
      if (!actorOwner) return Response.json({ success: false }, { status: 403 });
      const [target] = await tx.select({ id: staff.staffId, active: staff.isActive, adminEnabled: staff.adminEnabled, code: staff.staffCode, loginId: staff.adminLoginId, employeePinHash: staff.employeePinHash })
        .from(staff).where(eq(staff.staffId, targetId)).limit(1);
      if (!target || target.code === "000") return Response.json({ success: false, message: "직원을 찾을 수 없습니다." }, { status: 404 });
      const [membership] = await tx.select({ staffId: adminSecurityOwners.staffId })
        .from(adminSecurityOwners).where(eq(adminSecurityOwners.staffId, targetId)).limit(1);

      if (body.action === "add") {
        if (membership) return Response.json({ success: false, message: "이미 최고관리자로 지정된 직원입니다." }, { status: 409 });
        if (!canAddSecurityOwner({ isActive: target.active, adminEnabled: target.adminEnabled, loginId: target.loginId, employeePinHash: target.employeePinHash })) {
          return Response.json({ success: false, message: "활성 상태이며 관리센터 쓰기 권한과 공통 PIN이 있는 직원을 선택해 주세요." }, { status: 400 });
        }
        await tx.insert(adminSecurityOwners).values({ staffId: targetId, assignedByStaffId: actor.staffId });
      } else {
        if (!membership) return Response.json({ success: false, message: "최고관리자 지정 정보가 없습니다." }, { status: 404 });
        const owners = await tx.select({ staffId: adminSecurityOwners.staffId, masterPasswordHash: staff.securityPasswordHash,
          isActive: staff.isActive, adminEnabled: staff.adminEnabled, terminatedAt: staff.terminatedAt })
          .from(adminSecurityOwners).innerJoin(staff, eq(staff.staffId, adminSecurityOwners.staffId));
        if (!canRemoveSecurityOwner(owners, targetId)) {
          return Response.json({ success: false, message: "사용 가능한 최고관리자는 최소 1명 유지해야 합니다." }, { status: 409 });
        }
        await tx.delete(adminSecurityOwners).where(eq(adminSecurityOwners.staffId, targetId));
      }
      await tx.insert(auditLogs).values({ staffId: actor.staffId, actionType: `OWNER_${String(body.action).toUpperCase()}`, entityType: "ADMIN_SECURITY", entityId: targetId });
      return Response.json({ success: true });
    });
  } catch (error) {
    const detail = error as { code?: string; cause?: { code?: string } };
    console.error("Owner management failed", { code: detail?.code ?? detail?.cause?.code });
    return Response.json({ success: false, message: "최고관리자 설정을 저장하지 못했습니다." }, { status: 503 });
  }
}
