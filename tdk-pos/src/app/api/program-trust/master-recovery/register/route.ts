import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { adminSecurityOwners, auditLogs, masterPasswordRecoveryGrants,
  programTrustTokens, staff, staffSessions } from "@/db/schema";
import { hashProgramPassword, isValidProgramPassword } from "@/lib/auth";
import { reserveAdminStatusAttempt } from "@/lib/admin-auth-limit";
import { isHttpsSameOriginRequest } from "@/lib/kds-device";
import { getKdsRateLimitIp } from "@/lib/kds-network-server";
import { masterRecoveryCookieName, masterRecoveryCookieOptions } from "@/lib/master-recovery-cookie";
import { isSecureTrustRequest } from "@/lib/program-trust";

const noStore = { "Cache-Control": "no-store" };
const invalid = () => Response.json({ success: false, message: "복구 권한을 확인할 수 없습니다. NAS 관리자에게 새 복구 링크를 요청해 주세요." },
  { status: 401, headers: noStore });

/** A NAS-issued grant is consumed once, atomically with password replacement and lock reset. */
export async function POST(request: Request) {
  if (!isHttpsSameOriginRequest(request) || !isSecureTrustRequest(request))
    return Response.json({ success: false }, { status: 403, headers: noStore });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const loginId = typeof body?.loginId === "string" ? body.loginId.trim().toLowerCase() : "";
  const submittedToken = typeof body?.token === "string" ? body.token : "";
  const token = submittedToken || (await cookies()).get(masterRecoveryCookieName)?.value || "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(loginId) || !/^[A-Za-z0-9_-]{43}$/.test(token))
    return invalid();
  if (!isValidProgramPassword(password) || password !== body?.confirmPassword)
    return Response.json({ success: false, message: "마스터 비밀번호는 10자 이상이며 영문·숫자·특수문자를 포함해야 합니다." },
      { status: 400, headers: noStore });
  const ip = await getKdsRateLimitIp();
  try {
    const requestLimit = await reserveAdminStatusAttempt("master-recovery-register", ip);
    if (requestLimit === false) return Response.json({ success: false,
      message: "복구 요청이 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: noStore });
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const passwordHash = await hashProgramPassword(password);
    const completed = await db.transaction(async tx => {
      const [grant] = await tx.select({ grantId: masterPasswordRecoveryGrants.grantId,
        staffId: masterPasswordRecoveryGrants.staffId }).from(masterPasswordRecoveryGrants)
        .where(and(eq(masterPasswordRecoveryGrants.tokenHash, tokenHash),
          isNull(masterPasswordRecoveryGrants.usedAt), isNull(masterPasswordRecoveryGrants.revokedAt),
          sql`${masterPasswordRecoveryGrants.expiresAt} > NOW()`)).limit(1).for("update");
      if (!grant) return false;
      const [owner] = await tx.select({ staffId: staff.staffId }).from(staff)
        .innerJoin(adminSecurityOwners, eq(adminSecurityOwners.staffId, staff.staffId))
        .where(and(eq(staff.staffId, grant.staffId), sql`LOWER(${staff.adminLoginId}) = ${loginId}`,
          eq(staff.isActive, 1), eq(staff.adminEnabled, 1), isNull(staff.terminatedAt)))
        .limit(1).for("update");
      if (!owner) return false;
      const now = new Date();
      await tx.update(staff).set({ securityPasswordHash: passwordHash,
        securityPasswordChangeRequired: 0, updatedAt: now }).where(eq(staff.staffId, owner.staffId));
      await tx.update(masterPasswordRecoveryGrants).set({ usedAt: now })
        .where(eq(masterPasswordRecoveryGrants.grantId, grant.grantId));
      await tx.update(programTrustTokens).set({ revokedAt: now, revokeReason: "MASTER_PASSWORD_RECOVERED" })
        .where(and(eq(programTrustTokens.enrolledByStaffId, owner.staffId), isNull(programTrustTokens.revokedAt)));
      await tx.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: now, ownerReauthenticatedAt: null })
        .where(and(eq(staffSessions.staffId, owner.staffId), eq(staffSessions.status, "ACTIVE")));
      await tx.insert(auditLogs).values({ staffId: owner.staffId,
        actionType: "MASTER_PASSWORD_RECOVERED", entityType: "STAFF", entityId: owner.staffId });
      return true;
    });
    if (!completed) {
      return invalid();
    }
    const response = NextResponse.json({ success: true }, { headers: noStore });
    response.cookies.set(masterRecoveryCookieName, "", { ...masterRecoveryCookieOptions, maxAge: 0 });
    return response;
  } catch (error) {
    const detail = error as { code?: string; cause?: { code?: string } };
    console.error("Master password recovery failed", { code: detail.code ?? detail.cause?.code });
    return Response.json({ success: false, message: "마스터 비밀번호를 등록하지 못했습니다." },
      { status: 503, headers: noStore });
  }
}
