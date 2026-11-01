import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, programTrustTokens, staff, staffSessions } from "@/db/schema";
import { hashProgramPassword, isValidProgramPassword } from "@/lib/auth";
import { verifyMasterPassword } from "@/lib/master-password";
import { clearAdminAuthFailures, isAdminAuthAttemptAllowed, recordAdminAuthFailure,
  reserveAdminStatusAttempt } from "@/lib/admin-auth-limit";
import { isHttpsSameOriginRequest } from "@/lib/kds-device";
import { getKdsRateLimitIp } from "@/lib/kds-network-server";
import { isProgram, isSecureTrustRequest, programPermission } from "@/lib/program-trust";

const noStore = { "Cache-Control": "no-store" };
const invalid = () => NextResponse.json({ success: false, message: "ID 또는 임시 비밀번호를 확인해 주세요." },
  { status: 401, headers: noStore });

/** A temporary password is the sole first-login proof; it never issues a trust token. */
export async function POST(request: Request) {
  if (!isHttpsSameOriginRequest(request) || !isSecureTrustRequest(request))
    return NextResponse.json({ success: false }, { status: 403, headers: noStore });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const loginId = typeof body?.loginId === "string" ? body.loginId.trim().toLowerCase() : "";
  const temporaryPassword = typeof body?.temporaryPassword === "string" ? body.temporaryPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  const program = body?.program;
  if (!isProgram(program) || program === "HOS" || !/^[a-z][a-z0-9._-]{2,31}$/.test(loginId) ||
    temporaryPassword.length < 10 || temporaryPassword.length > 128 ||
    !isValidProgramPassword(newPassword) || newPassword !== body?.confirmPassword)
    return NextResponse.json({ success: false, message: "비밀번호 형식 또는 확인 값을 확인해 주세요." },
      { status: 400, headers: noStore });
  const ip = await getKdsRateLimitIp();
  const scope = "master-password";
  try {
    const [member] = await db.select({ staffId: staff.staffId, hash: staff.securityPasswordHash,
      changeRequired: staff.securityPasswordChangeRequired }).from(staff)
      .where(and(sql`LOWER(${staff.adminLoginId}) = ${loginId}`, eq(staff.isActive, 1),
        isNull(staff.terminatedAt), ne(staff.staffCode, "000"), eq(programPermission(program), 1))).limit(1);
    if (!member || member.changeRequired !== 1) {
      const allowed = await reserveAdminStatusAttempt(`temporary-password-invalid-${program.toLowerCase()}`, ip);
      return NextResponse.json({ success: false, message: allowed === false
        ? "요청이 많습니다. 잠시 후 다시 시도해 주세요." : "ID 또는 임시 비밀번호를 확인해 주세요." },
      { status: allowed === false ? 429 : 401, headers: noStore });
    }
    const account = String(member.staffId);
    if (!await isAdminAuthAttemptAllowed(scope, account, ip))
      return NextResponse.json({ success: false, message: "시도가 많습니다. 15분 후 다시 시도해 주세요." },
        { status: 429, headers: noStore });
    if (!await verifyMasterPassword(member.staffId, temporaryPassword)) {
      const allowed = await recordAdminAuthFailure(scope, account, ip);
      return allowed ? invalid() : NextResponse.json({ success: false,
        message: "시도가 많습니다. 15분 후 다시 시도해 주세요." }, { status: 429, headers: noStore });
    }
    if (await verifyMasterPassword(member.staffId, newPassword))
      return NextResponse.json({ success: false, message: "새 비밀번호를 기존 비밀번호와 다르게 설정해 주세요." },
        { status: 400, headers: noStore });
    const newHash = await hashProgramPassword(newPassword);
    const updated = await db.transaction(async tx => {
      const [current] = await tx.select({ hash: staff.securityPasswordHash,
        changeRequired: staff.securityPasswordChangeRequired }).from(staff)
        .where(and(eq(staff.staffId, member.staffId), eq(staff.isActive, 1),
          isNull(staff.terminatedAt), eq(programPermission(program), 1))).limit(1).for("update");
      if (!current || current.hash !== member.hash || current.changeRequired !== 1) return false;
      const now = new Date();
      await tx.update(staff).set({ securityPasswordHash: newHash,
        securityPasswordChangeRequired: 0, updatedAt: now }).where(eq(staff.staffId, member.staffId));
      await tx.update(programTrustTokens).set({ revokedAt: now, revokeReason: "PASSWORD_CHANGED" })
        .where(and(eq(programTrustTokens.enrolledByStaffId, member.staffId), isNull(programTrustTokens.revokedAt)));
      await tx.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: now, ownerReauthenticatedAt: null })
        .where(and(eq(staffSessions.staffId, member.staffId), eq(staffSessions.status, "ACTIVE")));
      await tx.insert(auditLogs).values({ staffId: member.staffId,
        actionType: "TEMPORARY_PROGRAM_PASSWORD_CHANGED", entityType: "STAFF", entityId: member.staffId });
      return true;
    });
    if (!updated) return invalid();
    await clearAdminAuthFailures(scope, String(member.staffId), ip);
    return NextResponse.json({ success: true }, { headers: noStore });
  } catch (error) {
    console.error("Temporary password change failed", { code: (error as { code?: string }).code });
    return NextResponse.json({ success: false, message: "인증 서비스를 이용할 수 없습니다." },
      { status: 503, headers: noStore });
  }
}
