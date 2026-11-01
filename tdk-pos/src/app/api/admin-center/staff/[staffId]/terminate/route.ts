import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { adminSecurityOwners, auditLogs, programTrustTokens, staff, staffSessions } from "@/db/schema";
import { getCurrentAdminStaff, requireOwnerSecurityAccess } from "@/lib/admin-auth";
import { isHttpsSameOriginRequest } from "@/lib/kds-device";
import { hasHosStaffPermissionColumn } from "@/lib/staff-management-server";

export async function POST(request: Request, { params }: { params: Promise<{ staffId: string }> }) {
  if (!isHttpsSameOriginRequest(request)) return Response.json({ success: false }, { status: 403 });
  const denied = await requireOwnerSecurityAccess();
  if (denied) return denied;
  const actor = await getCurrentAdminStaff();
  if (!actor) return Response.json({ success: false }, { status: 401 });
  const targetId = Number((await params).staffId);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return Response.json({ success: false }, { status: 400 });
  try {
    const hosPermissionAvailable = await hasHosStaffPermissionColumn();
    const result = await db.transaction(async tx => {
      const [target] = await tx.select({ staffId: staff.staffId, code: staff.staffCode,
        terminatedAt: staff.terminatedAt }).from(staff)
        .where(eq(staff.staffId, targetId)).limit(1).for("update");
      if (!target || target.code === "000") return { status: 404, message: "직원을 찾을 수 없습니다." };
      if (target.terminatedAt) return { status: 409, message: "이미 퇴사 처리된 직원입니다." };
      const [owner] = await tx.select({ staffId: adminSecurityOwners.staffId }).from(adminSecurityOwners)
        .where(eq(adminSecurityOwners.staffId, targetId)).limit(1);
      if (owner) return { status: 409, message: "최고관리자 권한을 안전하게 해제한 뒤 퇴사 처리해 주세요." };
      const now = new Date();
      await tx.update(staff).set({ isActive: 0, terminatedAt: now, posEnabled: 0,
        adminEnabled: 0, kdsEnabled: 0,
        ...(hosPermissionAvailable ? { hosEnabled: 0 } : {}), updatedAt: now })
        .where(eq(staff.staffId, targetId));
      const tokens = await tx.select({ tokenId: programTrustTokens.tokenId }).from(programTrustTokens)
        .where(and(eq(programTrustTokens.enrolledByStaffId, targetId), isNull(programTrustTokens.revokedAt)));
      await tx.update(programTrustTokens).set({ revokedAt: now, revokeReason: "EMPLOYEE_TERMINATED" })
        .where(and(eq(programTrustTokens.enrolledByStaffId, targetId), isNull(programTrustTokens.revokedAt)));
      for (const token of tokens) await tx.update(staffSessions)
        .set({ status: "LOGGED_OUT", loggedOutAt: now, ownerReauthenticatedAt: null })
        .where(and(eq(staffSessions.trustTokenId, token.tokenId), eq(staffSessions.status, "ACTIVE")));
      await tx.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: now, ownerReauthenticatedAt: null })
        .where(and(eq(staffSessions.staffId, targetId), eq(staffSessions.status, "ACTIVE")));
      await tx.insert(auditLogs).values({ staffId: actor.staffId, actionType: "STAFF_TERMINATED",
        entityType: "STAFF", entityId: targetId, description: `tokens=${tokens.length}` });
      return { status: 200, message: "퇴사 처리가 완료됐습니다." };
    });
    return Response.json({ success: result.status === 200, message: result.message }, { status: result.status });
  } catch (error) {
    const detail = error as { code?: string; cause?: { code?: string } };
    console.error("Staff termination failed", { code: detail.code ?? detail.cause?.code });
    return Response.json({ success: false, message: "퇴사 처리 중 오류가 발생했습니다." }, { status: 503 });
  }
}
