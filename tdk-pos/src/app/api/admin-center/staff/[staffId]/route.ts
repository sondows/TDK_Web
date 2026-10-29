import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminSecurityOwners, auditLogs, managedDevices, staff, staffSessions } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminAccess, requireOwnerSecurityAccess } from "@/lib/admin-auth";
import { hashEmployeePin } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/kds-device";
import { hasHosStaffPermissionColumn, isDuplicateAdminLoginId, parseStaffDraft, staffColumns, staffColumnsWithoutHos, toStaffSummary } from "@/lib/staff-management-server";

export async function PATCH(request: Request, { params }: { params: Promise<{ staffId: string }> }) {
  if (!isSameOriginRequest(request)) return Response.json({ success: false }, { status: 403 });
  const ownerDenied = await requireOwnerSecurityAccess(); if (ownerDenied) return ownerDenied;
  const writeDenied = await requireAdminAccess(); if (writeDenied) return writeDenied;
  const actor = await getCurrentAdminStaff();
  if (!actor) return Response.json({ success: false, message: "관리센터 로그인이 필요합니다." }, { status: 401 });
  const id = Number((await params).staffId);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ success: false, message: "직원을 찾을 수 없습니다." }, { status: 404 });
  let input: unknown;
  try { input = await request.json(); } catch { return Response.json({ success: false, message: "요청 형식을 확인해 주세요." }, { status: 400 }); }

  try {
    const hosPermissionAvailable = await hasHosStaffPermissionColumn();
    const result = await db.transaction(async tx => {
      const [target] = await tx.select(hosPermissionAvailable ? staffColumns : staffColumnsWithoutHos).from(staff).where(eq(staff.staffId, id)).limit(1).for("update");
      if (!target) return { status: 404, body: { success: false, message: "직원을 찾을 수 없습니다." } };
      if (target.staffCode === "000") {
        return { status: 403, body: { success: false, message: "매장 공용 계정은 직원 로그인과 직원관리에 사용할 수 없습니다." } };
      }
      const parsed = parseStaffDraft(input, toStaffSummary(target));
      if (!parsed) return { status: 400, body: { success: false, message: "요청 형식을 확인해 주세요." } };
      if (!parsed.valid) return { status: 400, body: { success: false, errors: parsed.errors, message: "입력 내용을 확인해 주세요." } };
      const { draft } = parsed;
      if (draft.hosEnabled && !hosPermissionAvailable) return { status: 503, body: { success: false, code: "STAFF_HOS_SCHEMA_REQUIRED", message: "HOS 직원 권한 컬럼이 DB에 없어 HOS 권한을 저장할 수 없습니다." } };
      if (draft.role !== target.role) return { status: 403, body: { success: false, message: "직급은 직원 수정 화면에서 변경할 수 없습니다." } };
      const [owner] = await tx.select({ staffId: adminSecurityOwners.staffId }).from(adminSecurityOwners)
        .where(eq(adminSecurityOwners.staffId, target.staffId)).limit(1);
      const isDesignatedOwner = owner?.staffId === target.staffId;
      if (isDesignatedOwner && actor.staffId !== target.staffId) {
        return { status: 403, body: { success: false, message: "지정된 최고관리자만 본인 계정을 수정할 수 있습니다." } };
      }
      if (isDesignatedOwner && (!draft.isActive || !draft.adminEnabled)) {
        return { status: 403, body: { success: false, message: "최고관리자 계정은 사용중지하거나 ADM 권한을 변경할 수 없습니다." } };
      }
      const [duplicate] = await tx.select({ staffId: staff.staffId }).from(staff)
        .where(and(sql`LOWER(${staff.adminLoginId}) = ${draft.loginId}`, ne(staff.staffId, id))).limit(1);
      if (duplicate) return { status: 409, body: { success: false, errors: { loginId: "이미 사용 중인 ID입니다." }, message: "이미 사용 중인 ID입니다." } };
      const sharedHash = draft.employeePin ? await hashEmployeePin(draft.employeePin) : target.employeePinHash;
      await tx.update(staff).set({
        name: draft.name, adminLoginId: draft.loginId, role: target.role, isActive: draft.isActive ? 1 : 0,
        posEnabled: draft.posEnabled ? 1 : 0, employeePinHash: sharedHash,
        kdsEnabled: draft.kdsEnabled ? 1 : 0,
        ...(hosPermissionAvailable ? { hosEnabled: draft.hosEnabled ? 1 : 0 } : {}),
        // Legacy KDS credentials are deliberately retained; the staff form no longer edits them.
        kdsPinChangeRequired: draft.employeePin ? 0 : target.kdsPinChangeRequired,
        adminEnabled: draft.adminEnabled ? 1 : 0,
        updatedAt: new Date(),
      }).where(eq(staff.staffId, id));

      const loginIdChanged = draft.loginId !== (target.adminLoginId ?? "").toLowerCase();
      const reauthRequired = actor.staffId === id && (Boolean(draft.employeePin) || loginIdChanged);
      if (draft.employeePin || loginIdChanged || !draft.isActive || !draft.posEnabled || !draft.kdsEnabled || !draft.adminEnabled) {
        const sessionTypes = [] as ("POS" | "KDS" | "ADMIN")[];
        if (draft.employeePin || loginIdChanged || !draft.isActive || !draft.posEnabled) sessionTypes.push("POS");
        if (draft.employeePin || loginIdChanged || !draft.isActive || !draft.kdsEnabled) sessionTypes.push("KDS");
        if (draft.employeePin || loginIdChanged || !draft.isActive || !draft.adminEnabled) sessionTypes.push("ADMIN");
        for (const sessionType of sessionTypes) await tx.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: new Date(), ownerReauthenticatedAt: null }).where(and(
          eq(staffSessions.staffId, id), eq(staffSessions.sessionType, sessionType), eq(staffSessions.status, "ACTIVE"),
        ));
      }
      if (!draft.isActive || !draft.kdsEnabled) await tx.update(managedDevices).set({ status: "REVOKED", revokedAt: new Date(), updatedAt: new Date() }).where(and(
        eq(managedDevices.registeredByStaffId, id), eq(managedDevices.deviceType, "KDS"), eq(managedDevices.status, "APPROVED"),
      ));
      await tx.insert(auditLogs).values({ staffId: actor.staffId, actionType: "STAFF_UPDATED", entityType: "STAFF", entityId: id, description: "Employee profile and access permissions updated" });
      return { status: 200, body: { success: true, reauthRequired } };
    });
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    if (isDuplicateAdminLoginId(error)) return Response.json({ success: false, errors: { loginId: "이미 사용 중인 ID입니다." }, message: "이미 사용 중인 ID입니다." }, { status: 409 });
    const detail = error as { code?: string; cause?: { code?: string } };
    console.error("Admin staff update failed", { code: detail?.code ?? detail?.cause?.code });
    return Response.json({ success: false, message: "직원 정보를 저장하지 못했습니다." }, { status: 500 });
  }
}
