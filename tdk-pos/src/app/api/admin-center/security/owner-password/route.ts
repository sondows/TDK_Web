import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { adminSecurityOwners, auditLogs, staff, staffSessions } from "@/db/schema";
import { ADMIN_SESSION_COOKIE_NAME, getCurrentAdminStaff, getOwnerSecurityState } from "@/lib/admin-auth";
import { hashProgramPassword, hashSessionToken, isValidProgramPassword } from "@/lib/auth";
import { verifyMasterPassword } from "@/lib/master-password";
import { isSameOriginRequest } from "@/lib/kds-device";
import { getKdsRateLimitIp } from "@/lib/kds-network-server";
import { clearAdminAuthFailures, isAdminAuthAttemptAllowed, recordAdminAuthFailure } from "@/lib/admin-auth-limit";

const invalid = (status = 401) => Response.json({ success: false, message: status === 429 ? "시도가 많습니다. 잠시 후 다시 시도해 주세요." : "관리자 보안 비밀번호 인증을 완료하지 못했습니다." }, { status });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ success: false }, { status: 403 });
  const actor = await getCurrentAdminStaff();
  if (!actor) return Response.json({ success: false, message: "관리센터 로그인이 필요합니다." }, { status: 401 });
  const state = await getOwnerSecurityState();
  if (state === "NOT_OWNER") return Response.json({ success: false, message: "지정된 OWNER 계정만 설정할 수 있습니다." }, { status: 403 });
  const body = await request.json().catch(() => null) as { action?: unknown; password?: unknown; confirm?: unknown; oldPassword?: unknown; newPassword?: unknown } | null;
  if (!body || typeof body.action !== "string") return Response.json({ success: false }, { status: 400 });
  const ip = await getKdsRateLimitIp();
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
  if (!token) return Response.json({ success: false }, { status: 401 });
  const sessionHash = hashSessionToken(token);

  if (body.action === "setup") return Response.json({ success: false, message: "Use the employee master-password setup flow." }, { status: 409 });

  if (body.action === "verify") {
    if (state !== "NEEDS_REAUTH" && state !== "AUTHORIZED") return invalid(403);
    if (typeof body.password !== "string") return invalid();
    try {
      if (!await isAdminAuthAttemptAllowed("master-password", String(actor.staffId), ip)) return invalid(429);
      if (!await verifyMasterPassword(actor.staffId, body.password)) {
        const allowed = await recordAdminAuthFailure("master-password", String(actor.staffId), ip);
        await db.insert(auditLogs).values({ staffId: actor.staffId, actionType: "OWNER_SECURITY_AUTH_FAILED", entityType: "ADMIN_SECURITY" });
        return invalid(allowed ? 401 : 429);
      }
      await clearAdminAuthFailures("master-password", String(actor.staffId), ip);
      await db.update(staffSessions).set({ ownerReauthenticatedAt: new Date() }).where(and(eq(staffSessions.sessionTokenHash, sessionHash), eq(staffSessions.sessionType, "ADMIN"), eq(staffSessions.status, "ACTIVE")));
      await db.insert(auditLogs).values({ staffId: actor.staffId, actionType: "OWNER_SECURITY_AUTH_SUCCEEDED", entityType: "ADMIN_SECURITY" });
      return Response.json({ success: true });
    } catch (error) {
      const detail = error as { code?: string; cause?: { code?: string } };
      console.error("Owner security verification failed", { code: detail?.code ?? detail?.cause?.code });
      return Response.json({ success: false, message: "보안 인증 서비스를 이용할 수 없습니다." }, { status: 503 });
    }
  }

  if (body.action === "change") {
    if (state !== "AUTHORIZED" || typeof body.oldPassword !== "string" || typeof body.newPassword !== "string" ||
      !isValidProgramPassword(body.newPassword) || body.newPassword !== body.confirm) return invalid(403);
    try {
      const scope = "master-password";
      if (!await isAdminAuthAttemptAllowed(scope, String(actor.staffId), ip)) return invalid(429);
      const [credential] = await db.select({ hash: staff.securityPasswordHash })
        .from(staff).where(eq(staff.staffId, actor.staffId)).limit(1);
      if (!credential?.hash || !await verifyMasterPassword(actor.staffId, body.oldPassword)) {
        const allowed = await recordAdminAuthFailure(scope, String(actor.staffId), ip);
        return invalid(allowed ? 401 : 429);
      }
      if (await verifyMasterPassword(actor.staffId, body.newPassword))
        return Response.json({ success: false, message: "새 마스터 비밀번호는 현재 비밀번호와 달라야 합니다." }, { status: 400 });
      const nextHash = await hashProgramPassword(body.newPassword);
      await db.transaction(async tx => {
        const [current] = await tx.select({ hash: staff.securityPasswordHash, active: staff.isActive,
          adminEnabled: staff.adminEnabled, terminatedAt: staff.terminatedAt }).from(staff)
          .where(eq(staff.staffId, actor.staffId)).limit(1).for("update");
        const [owner] = await tx.select({ staffId: adminSecurityOwners.staffId }).from(adminSecurityOwners)
          .where(eq(adminSecurityOwners.staffId, actor.staffId)).limit(1).for("update");
        if (!current || !owner || Number(current.active) !== 1 || current.terminatedAt || Number(current.adminEnabled) !== 1 ||
          current.hash !== credential.hash) throw new Error("Owner or master credential changed during password update");
        const now = new Date();
        await tx.update(staff).set({ securityPasswordHash: nextHash,
          securityPasswordChangeRequired: 0, updatedAt: now }).where(eq(staff.staffId, actor.staffId));
        await tx.update(staffSessions).set({ ownerReauthenticatedAt: null })
          .where(and(eq(staffSessions.staffId, actor.staffId), eq(staffSessions.sessionType, "ADMIN"), eq(staffSessions.status, "ACTIVE")));
        await tx.insert(auditLogs).values({ staffId: actor.staffId,
          actionType: "OWNER_MASTER_PASSWORD_CHANGED", entityType: "STAFF", entityId: actor.staffId });
      });
      await clearAdminAuthFailures(scope, String(actor.staffId), ip);
      return Response.json({ success: true, reauthenticate: true });
    } catch (error) {
      const detail = error as { code?: string; cause?: { code?: string } };
      console.error("Owner master password change failed", { code: detail.code ?? detail.cause?.code });
      return Response.json({ success: false, message: "Master password could not be changed." }, { status: 503 });
    }
  }
  return Response.json({ success: false }, { status: 400 });
}
