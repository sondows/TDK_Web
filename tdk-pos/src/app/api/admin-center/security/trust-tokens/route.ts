import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, programTrustTokens, staff, staffSessions } from "@/db/schema";
import { getCurrentAdminStaff, requireOwnerSecurityAccess } from "@/lib/admin-auth";
import { isHttpsSameOriginRequest } from "@/lib/kds-device";
import { hasHosStaffPermissionColumn } from "@/lib/staff-management-server";

export async function GET() {
  const denied = await requireOwnerSecurityAccess();
  if (denied) return denied;
  try {
    const hosPermissionAvailable = await hasHosStaffPermissionColumn();
    const rows = await db.select({
      tokenId: programTrustTokens.tokenId, program: programTrustTokens.program,
      staffId: staff.staffId, loginId: staff.adminLoginId, staffName: staff.name,
      staffActive: staff.isActive, terminatedAt: staff.terminatedAt,
      posEnabled: staff.posEnabled, adminEnabled: staff.adminEnabled,
      kdsEnabled: staff.kdsEnabled,
      ...(hosPermissionAvailable ? { hosEnabled: staff.hosEnabled } : {}),
      clientLabel: programTrustTokens.clientLabel, revokeReason: programTrustTokens.revokeReason,
      createdAt: programTrustTokens.createdAt, lastUsedAt: programTrustTokens.lastUsedAt,
      revokedAt: programTrustTokens.revokedAt,
    }).from(programTrustTokens).innerJoin(staff, eq(staff.staffId, programTrustTokens.enrolledByStaffId))
      .orderBy(desc(programTrustTokens.createdAt));
    const tokens = rows.map(row => {
      const permission = row.program === "POS" ? row.posEnabled : row.program === "ADM" ? row.adminEnabled :
        row.program === "KDS" ? row.kdsEnabled : "hosEnabled" in row ? row.hosEnabled : 0;
      return { tokenId: row.tokenId, program: row.program, staffId: row.staffId,
        loginId: row.loginId, staffName: row.staffName, clientLabel: row.clientLabel,
        createdAt: row.createdAt, lastUsedAt: row.lastUsedAt, revokedAt: row.revokedAt,
        revokeReason: row.revokeReason,
        status: row.revokedAt ? "REVOKED" : row.terminatedAt || Number(row.staffActive) !== 1 ||
          Number(permission) !== 1 ? "INVALID" : "ACTIVE" };
    });
    return Response.json({ success: true, tokens }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Program trust token list failed", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "토큰 목록을 불러오지 못했습니다." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  if (!isHttpsSameOriginRequest(request)) return Response.json({ success: false }, { status: 403 });
  const denied = await requireOwnerSecurityAccess();
  if (denied) return denied;
  const actor = await getCurrentAdminStaff();
  if (!actor) return Response.json({ success: false }, { status: 401 });
  const body = await request.json().catch(() => null) as { tokenId?: unknown; staffId?: unknown } | null;
  const tokenId = Number(body?.tokenId);
  const staffId = Number(body?.staffId);
  const revokeStaff = body?.staffId !== undefined && body?.tokenId === undefined;
  if (revokeStaff ? !Number.isSafeInteger(staffId) || staffId <= 0 :
    !Number.isSafeInteger(tokenId) || tokenId <= 0 || body?.staffId !== undefined)
    return Response.json({ success: false }, { status: 400 });
  try {
    const changed = await db.transaction(async tx => {
      const tokens = await tx.select({ tokenId: programTrustTokens.tokenId }).from(programTrustTokens)
        .where(and(revokeStaff ? eq(programTrustTokens.enrolledByStaffId, staffId) :
          eq(programTrustTokens.tokenId, tokenId), isNull(programTrustTokens.revokedAt))).for("update");
      if (!tokens.length) return false;
      const now = new Date();
      for (const token of tokens) {
        await tx.update(programTrustTokens).set({ revokedAt: now,
          revokeReason: revokeStaff ? "ADMIN_REVOKED_ALL" : "ADMIN_REVOKED" })
          .where(eq(programTrustTokens.tokenId, token.tokenId));
        await tx.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: now, ownerReauthenticatedAt: null })
          .where(and(eq(staffSessions.trustTokenId, token.tokenId), eq(staffSessions.status, "ACTIVE")));
      }
      await tx.insert(auditLogs).values({ staffId: actor.staffId, actionType: "PROGRAM_TRUST_REVOKED",
        entityType: revokeStaff ? "STAFF" : "PROGRAM_TRUST", entityId: revokeStaff ? staffId : tokenId,
        description: `count=${tokens.length}; reason=admin` });
      return true;
    });
    return changed ? Response.json({ success: true }) : Response.json({ success: false }, { status: 404 });
  } catch (error) {
    console.error("Program trust token revoke failed", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "토큰을 폐기하지 못했습니다." }, { status: 503 });
  }
}
