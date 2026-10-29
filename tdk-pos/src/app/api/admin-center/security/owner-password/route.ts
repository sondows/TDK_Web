import { and, eq, inArray, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { adminSecurityOwners, auditLogs, staffSessions } from "@/db/schema";
import { ADMIN_SESSION_COOKIE_NAME, getCurrentAdminStaff, getOwnerSecurityState } from "@/lib/admin-auth";
import { hashOwnerSecurityPassword, hashSessionToken, isValidOwnerSecurityPassword, verifySecurityPassword } from "@/lib/auth";
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

  if (body.action === "setup") {
    if (state !== "OWNER_UNCONFIGURED" || typeof body.password !== "string" || !isValidOwnerSecurityPassword(body.password) || body.password !== body.confirm) {
      return Response.json({ success: false, message: "특수문자를 포함한 10자 이상 비밀번호를 입력하고 확인란과 일치시켜 주세요." }, { status: 400 });
    }
    try {
      const passwordHash = await hashOwnerSecurityPassword(body.password);
      const [updated] = await db.update(adminSecurityOwners).set({ passwordHash, credentialState: "ACTIVE", updatedAt: new Date() })
        .where(and(eq(adminSecurityOwners.staffId, actor.staffId), isNull(adminSecurityOwners.passwordHash), inArray(adminSecurityOwners.credentialState, ["SETUP_PENDING", "RESET_REQUIRED"])));
      if (!updated.affectedRows) return Response.json({ success: false, message: "이미 설정되었거나 OWNER 지정 상태가 변경되었습니다. 새로고침해 주세요." }, { status: 409 });
      await db.update(staffSessions).set({ ownerReauthenticatedAt: new Date() }).where(and(eq(staffSessions.sessionTokenHash, sessionHash), eq(staffSessions.sessionType, "ADMIN"), eq(staffSessions.status, "ACTIVE")));
      await db.insert(auditLogs).values({ staffId: actor.staffId, actionType: "OWNER_SECURITY_PASSWORD_SET", entityType: "ADMIN_SECURITY", description: "Initial owner security password configured" });
      return Response.json({ success: true });
    } catch (error) {
      const detail = error as { code?: string; cause?: { code?: string } };
      console.error("Owner security password setup failed", { code: detail?.code ?? detail?.cause?.code });
      return Response.json({ success: false, message: "보안 비밀번호를 설정하지 못했습니다." }, { status: 503 });
    }
  }

  if (body.action === "verify") {
    if (state !== "NEEDS_REAUTH" && state !== "AUTHORIZED") return invalid(403);
    if (typeof body.password !== "string") return invalid();
    try {
      if (!await isAdminAuthAttemptAllowed("owner-security", String(actor.staffId), ip)) return invalid(429);
      const [settings] = await db.select({ hash: adminSecurityOwners.passwordHash, state: adminSecurityOwners.credentialState })
        .from(adminSecurityOwners).where(eq(adminSecurityOwners.staffId, actor.staffId)).limit(1);
      if (settings?.state !== "ACTIVE" || !(await verifySecurityPassword(body.password, settings?.hash ?? null))) {
        const allowed = await recordAdminAuthFailure("owner-security", String(actor.staffId), ip);
        await db.insert(auditLogs).values({ staffId: actor.staffId, actionType: "OWNER_SECURITY_AUTH_FAILED", entityType: "ADMIN_SECURITY" });
        return invalid(allowed ? 401 : 429);
      }
      await clearAdminAuthFailures("owner-security", String(actor.staffId), ip);
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
    if (state !== "AUTHORIZED" || typeof body.oldPassword !== "string" || typeof body.newPassword !== "string" || !isValidOwnerSecurityPassword(body.newPassword)) return invalid(403);
    try {
      if (!await isAdminAuthAttemptAllowed("owner-security-change", String(actor.staffId), ip)) return invalid(429);
      const [settings] = await db.select({ hash: adminSecurityOwners.passwordHash, state: adminSecurityOwners.credentialState }).from(adminSecurityOwners).where(eq(adminSecurityOwners.staffId, actor.staffId)).limit(1);
      if (settings?.state !== "ACTIVE" || !(await verifySecurityPassword(body.oldPassword, settings?.hash ?? null))) {
        const allowed = await recordAdminAuthFailure("owner-security-change", String(actor.staffId), ip);
        return invalid(allowed ? 401 : 429);
      }
      const nextHash = await hashOwnerSecurityPassword(body.newPassword);
      await db.transaction(async tx => {
        const [updated] = await tx.update(adminSecurityOwners).set({ passwordHash: nextHash, updatedAt: new Date() })
          .where(and(eq(adminSecurityOwners.staffId, actor.staffId), eq(adminSecurityOwners.passwordHash, settings.hash!)));
        if (!updated.affectedRows) throw new Error("Owner credential changed during password update");
        await tx.update(staffSessions).set({ ownerReauthenticatedAt: null }).where(and(eq(staffSessions.staffId, actor.staffId), eq(staffSessions.sessionType, "ADMIN"), eq(staffSessions.status, "ACTIVE")));
        await tx.insert(auditLogs).values({ staffId: actor.staffId, actionType: "OWNER_SECURITY_PASSWORD_CHANGED", entityType: "ADMIN_SECURITY" });
      });
      await clearAdminAuthFailures("owner-security-change", String(actor.staffId), ip);
      return Response.json({ success: true, reauthenticate: true });
    } catch { return Response.json({ success: false, message: "보안 비밀번호를 변경하지 못했습니다." }, { status: 503 }); }
  }
  return Response.json({ success: false }, { status: 400 });
}
