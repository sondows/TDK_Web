import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, programTrustTokens, staff, staffSessions } from "@/db/schema";
import { getCurrentAdminStaff, requireOwnerSecurityAccess } from "@/lib/admin-auth";
import { isHttpsSameOriginRequest } from "@/lib/kds-device";

/** Reset a target employee's credentials and revoke every program trust/session atomically. */
export async function POST(request: Request, { params }: { params: Promise<{ staffId: string }> }) {
  if (!isHttpsSameOriginRequest(request)) return Response.json({ success: false }, { status: 403 });
  const body = await request.json().catch(() => null) as { confirmed?: unknown } | null;
  if (body?.confirmed !== true) return Response.json({ success: false }, { status: 400 });

  const denied = await requireOwnerSecurityAccess();
  if (denied) return denied;
  const actor = await getCurrentAdminStaff();
  if (!actor) return Response.json({ success: false }, { status: 401 });
  const targetId = Number((await params).staffId);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return Response.json({ success: false }, { status: 400 });
  if (targetId === actor.staffId) return Response.json({ success: false,
    message: "본인의 인증정보는 직원관리에서 초기화할 수 없습니다." }, { status: 403 });

  try {
    const reset = await db.transaction(async tx => {
      const [target] = await tx.select({ staffId: staff.staffId }).from(staff)
        .where(and(eq(staff.staffId, targetId), ne(staff.staffCode, "000"),
          eq(staff.isActive, 1), isNull(staff.terminatedAt))).limit(1).for("update");
      if (!target) return false;

      const now = new Date();
      await tx.update(staff).set({
        securityPasswordHash: null,
        employeePinHash: null,
        securityPasswordChangeRequired: 1,
        kdsPinChangeRequired: 1,
        updatedAt: now,
      }).where(eq(staff.staffId, targetId));
      await tx.update(programTrustTokens).set({ revokedAt: now, revokeReason: "CREDENTIALS_RESET" })
        .where(and(eq(programTrustTokens.enrolledByStaffId, targetId), isNull(programTrustTokens.revokedAt)));
      await tx.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: now, ownerReauthenticatedAt: null })
        .where(and(eq(staffSessions.staffId, targetId), eq(staffSessions.status, "ACTIVE")));
      await tx.insert(auditLogs).values({ staffId: actor.staffId,
        actionType: "STAFF_CREDENTIALS_RESET", entityType: "STAFF", entityId: targetId });
      return true;
    });

    return reset ? Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } }) :
      Response.json({ success: false, message: "초기화할 수 있는 활성 직원 계정을 찾지 못했습니다." }, { status: 404 });
  } catch (error) {
    console.error("Staff credential reset failed", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "직원 인증정보를 초기화하지 못했습니다." }, { status: 503 });
  }
}
