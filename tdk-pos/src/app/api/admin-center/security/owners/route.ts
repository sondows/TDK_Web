import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { adminSecurityOwners, adminSecuritySettings, auditLogs, staff, staffSessions } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminAccess, requireOwnerSecurityAccess } from "@/lib/admin-auth";
import { canAddSecurityOwner, canRemoveSecurityOwner, canResetSecurityOwner } from "@/lib/admin-security-owners";
import { verifySecurityPassword } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/kds-device";
import { getKdsRateLimitIp } from "@/lib/kds-network-server";
import { clearAdminAuthFailures, isAdminAuthAttemptAllowed, recordAdminAuthFailure } from "@/lib/admin-auth-limit";

export async function GET() {
  const denied = await requireOwnerSecurityAccess();
  if (denied) return denied;
  try {
    const [owners, employees] = await Promise.all([
      db.select({ staffId: adminSecurityOwners.staffId, credentialState: adminSecurityOwners.credentialState, name: staff.name, loginId: staff.adminLoginId })
        .from(adminSecurityOwners).innerJoin(staff, eq(staff.staffId, adminSecurityOwners.staffId)),
      db.select({ staffId: staff.staffId, name: staff.name, loginId: staff.adminLoginId })
        .from(staff).where(and(eq(staff.isActive, 1), eq(staff.adminEnabled, 1), ne(staff.staffCode, "000"))),
    ]);
    return Response.json({ success: true, owners: owners.map(({ credentialState, ...owner }) => ({ ...owner, status: credentialState })), employees });
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
  const body = await request.json().catch(() => null) as { action?: unknown; staffId?: unknown; password?: unknown } | null;
  const id = body?.staffId;
  if (!body || !["add", "revoke", "reset"].includes(String(body.action)) || !Number.isSafeInteger(id) || Number(id) <= 0) {
    return Response.json({ success: false, message: "요청 내용을 확인해 주세요." }, { status: 400 });
  }
  const targetId = Number(id);
  try {
    let verifiedActorHash: string | null = null;
    if (body.action === "reset") {
      if (targetId === actor.staffId) return Response.json({ success: false, message: "본인 비밀번호는 직접 변경하거나 별도 복구 절차를 이용해 주세요." }, { status: 403 });
      if (typeof body.password !== "string" || body.password.length > 128) return Response.json({ success: false, message: "현재 최고관리자 보안 비밀번호를 입력해 주세요." }, { status: 400 });
      const ip = await getKdsRateLimitIp();
      const scope = "owner-reset-confirm";
      if (!await isAdminAuthAttemptAllowed(scope, String(actor.staffId), ip)) return Response.json({ success: false, message: "시도가 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
      const [credential] = await db.select({ hash: adminSecurityOwners.passwordHash, state: adminSecurityOwners.credentialState })
        .from(adminSecurityOwners).where(eq(adminSecurityOwners.staffId, actor.staffId)).limit(1);
      if (credential?.state !== "ACTIVE" || !credential.hash || !(await verifySecurityPassword(body.password, credential.hash))) {
        const allowed = await recordAdminAuthFailure(scope, String(actor.staffId), ip);
        await db.insert(auditLogs).values({ staffId: actor.staffId, actionType: "OWNER_RESET_AUTH_FAILED", entityType: "ADMIN_SECURITY", entityId: targetId });
        return Response.json({ success: false, message: allowed ? "보안 비밀번호를 확인해 주세요." : "시도가 많습니다. 잠시 후 다시 시도해 주세요." }, { status: allowed ? 401 : 429 });
      }
      await clearAdminAuthFailures(scope, String(actor.staffId), ip);
      verifiedActorHash = credential.hash;
    }
    return await db.transaction(async tx => {
      // Serialize membership changes and last-owner checks on the existing singleton row.
      const [settings] = await tx.select({ id: adminSecuritySettings.settingsId }).from(adminSecuritySettings)
        .where(eq(adminSecuritySettings.settingsId, 1)).limit(1).for("update");
      if (!settings) return Response.json({ success: false, message: "보안 설정이 없습니다." }, { status: 503 });
      const [actorOwner] = await tx.select({ hash: adminSecurityOwners.passwordHash }).from(adminSecurityOwners)
        .where(eq(adminSecurityOwners.staffId, actor.staffId)).limit(1);
      if (!actorOwner?.hash) return Response.json({ success: false }, { status: 403 });
      if (body.action === "reset" && actorOwner.hash !== verifiedActorHash) return Response.json({ success: false, message: "인증 정보가 변경되었습니다. 다시 시도해 주세요." }, { status: 409 });
      const [target] = await tx.select({ id: staff.staffId, active: staff.isActive, adminEnabled: staff.adminEnabled, code: staff.staffCode, loginId: staff.adminLoginId, employeePinHash: staff.employeePinHash })
        .from(staff).where(eq(staff.staffId, targetId)).limit(1);
      if (!target || target.code === "000") return Response.json({ success: false, message: "직원을 찾을 수 없습니다." }, { status: 404 });
      const [membership] = await tx.select({ staffId: adminSecurityOwners.staffId, hash: adminSecurityOwners.passwordHash, credentialState: adminSecurityOwners.credentialState })
        .from(adminSecurityOwners).where(eq(adminSecurityOwners.staffId, targetId)).limit(1);

      if (body.action === "add") {
        if (membership) return Response.json({ success: false, message: "이미 최고관리자로 지정된 직원입니다." }, { status: 409 });
        if (!canAddSecurityOwner({ isActive: target.active, adminEnabled: target.adminEnabled, loginId: target.loginId, employeePinHash: target.employeePinHash })) {
          return Response.json({ success: false, message: "활성 상태이며 관리센터 쓰기 권한과 공통 PIN이 있는 직원을 선택해 주세요." }, { status: 400 });
        }
        await tx.insert(adminSecurityOwners).values({ staffId: targetId, assignedByStaffId: actor.staffId });
      } else {
        if (!membership) return Response.json({ success: false, message: "최고관리자 지정 정보가 없습니다." }, { status: 404 });
        if (body.action === "reset") {
          const owners = await tx.select({ staffId: adminSecurityOwners.staffId, passwordHash: adminSecurityOwners.passwordHash, credentialState: adminSecurityOwners.credentialState }).from(adminSecurityOwners);
          if (!canResetSecurityOwner(owners, actor.staffId, targetId)) return Response.json({ success: false, message: "대상 상태를 확인하거나 사용 가능한 다른 최고관리자가 있는지 확인해 주세요." }, { status: 409 });
          await tx.update(adminSecurityOwners).set({ passwordHash: null, credentialState: "RESET_REQUIRED", updatedAt: new Date() }).where(eq(adminSecurityOwners.staffId, targetId));
          await tx.insert(auditLogs).values({ staffId: actor.staffId, actionType: "OWNER_PASSWORD_RESET_APPROVED", entityType: "ADMIN_SECURITY", entityId: targetId });
        } else {
          const owners = await tx.select({ staffId: adminSecurityOwners.staffId, passwordHash: adminSecurityOwners.passwordHash }).from(adminSecurityOwners);
          if (!canRemoveSecurityOwner(owners, targetId)) {
            return Response.json({ success: false, message: "사용 가능한 최고관리자는 최소 1명 유지해야 합니다." }, { status: 409 });
          }
          await tx.delete(adminSecurityOwners).where(eq(adminSecurityOwners.staffId, targetId));
        }
        await tx.update(staffSessions).set({ ownerReauthenticatedAt: null })
          .where(and(eq(staffSessions.staffId, targetId), eq(staffSessions.sessionType, "ADMIN"), eq(staffSessions.status, "ACTIVE")));
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
