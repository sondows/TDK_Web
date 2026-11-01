import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { adminSecurityOwners, auditLogs, staff } from "@/db/schema";
import { hashProgramPassword, isValidProgramPassword } from "@/lib/auth";
import { reserveAdminStatusAttempt } from "@/lib/admin-auth-limit";
import { getKdsRateLimitIp } from "@/lib/kds-network-server";
import { isNasOwnerSetupWrite } from "@/lib/nas-owner-setup";
import { isHttpsSameOriginRequest } from "@/lib/kds-device";
import { classifyInitialMasterAccount } from "@/lib/initial-admin-setup";

const noStore = { "Cache-Control": "no-store" };

/** Initial owner setup or a one-time re-enrollment explicitly authorized by an OWNER reset. */
export async function POST(request: Request) {
  const setupWrite = isNasOwnerSetupWrite(request);
  if (!setupWrite && !isHttpsSameOriginRequest(request))
    return NextResponse.json({ success: false }, { status: 403, headers: noStore });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const loginId = typeof body?.loginId === "string" ? body.loginId.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const requestedProgram = new URL(request.url).searchParams.get("program");
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(loginId) || !isValidProgramPassword(password) ||
    password !== body?.confirmPassword)
    return NextResponse.json({ success: false,
      message: "마스터 비밀번호는 10자 이상이며 영문, 숫자, 특수문자를 포함해야 하고 확인값과 일치해야 합니다." },
    { status: 400, headers: noStore });

  const ip = await getKdsRateLimitIp();
  try {
    const requestLimit = await reserveAdminStatusAttempt(
      `master-register-${(requestedProgram ?? "adm").toLowerCase()}`, ip);
    if (requestLimit === false) return NextResponse.json({ success: false,
      message: "비밀번호 등록 요청이 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: noStore });
    const passwordHash = await hashProgramPassword(password);
    const outcome = await db.transaction(async tx => {
      const [candidate] = await tx.select({ staffId: staff.staffId, passwordHash: staff.securityPasswordHash,
        resetRequired: staff.securityPasswordChangeRequired, role: staff.role, active: staff.isActive,
        adminEnabled: staff.adminEnabled, terminatedAt: staff.terminatedAt,
        staffCode: staff.staffCode, posEnabled: staff.posEnabled }).from(staff)
        .where(sql`LOWER(${staff.adminLoginId}) = ${loginId}`)
        .limit(1).for("update");
      if (!candidate) return null;

      if (candidate.passwordHash === null && candidate.resetRequired === 1 && candidate.active === 1 &&
        !candidate.terminatedAt && candidate.staffCode !== "000" &&
        (requestedProgram !== "POS" || candidate.posEnabled === 1)) {
        const updated = await tx.update(staff).set({ securityPasswordHash: passwordHash,
          securityPasswordChangeRequired: 0, updatedAt: new Date() }).where(and(
          eq(staff.staffId, candidate.staffId), eq(staff.securityPasswordChangeRequired, 1),
          isNull(staff.securityPasswordHash)));
        if (Number(updated[0].affectedRows) !== 1) return null;
        await tx.insert(auditLogs).values({ staffId: candidate.staffId,
          actionType: "STAFF_MASTER_PASSWORD_REENROLLED", entityType: "STAFF", entityId: candidate.staffId });
        return { staffId: candidate.staffId, kind: "reset" as const };
      }

      if (!setupWrite) return null;
      const [owner] = await tx.select({ staffId: adminSecurityOwners.staffId }).from(adminSecurityOwners)
        .where(eq(adminSecurityOwners.staffId, candidate.staffId)).limit(1).for("update");
      const accountState = classifyInitialMasterAccount({ accountFound: true,
        passwordHash: candidate.passwordHash, role: candidate.role, active: candidate.active,
        adminEnabled: candidate.adminEnabled, terminatedAt: candidate.terminatedAt,
        staffCode: candidate.staffCode, isOwner: Boolean(owner) });
      if (accountState !== "MASTER_PASSWORD_REQUIRED") return null;
      if (requestedProgram === "POS" && candidate.posEnabled !== 1) return null;
      const updated = await tx.update(staff).set({ securityPasswordHash: passwordHash, updatedAt: new Date() })
        .where(and(eq(staff.staffId, candidate.staffId), isNull(staff.securityPasswordHash)));
      if (Number(updated[0].affectedRows) !== 1) return null;
      await tx.insert(auditLogs).values({ staffId: candidate.staffId,
        actionType: "MASTER_PASSWORD_REGISTERED", entityType: "STAFF", entityId: candidate.staffId });
      return { staffId: candidate.staffId, kind: "initial" as const };
    });
    if (!outcome) {
      return NextResponse.json({ success: false,
        message: "초기 설정 또는 관리자 승인으로 초기화된 계정만 비밀번호를 등록할 수 있습니다." },
      { status: 409, headers: noStore });
    }
    return NextResponse.json({ success: true }, { headers: noStore });
  } catch (error) {
    const detail = error as { code?: string; cause?: { code?: string } };
    console.error("Initial master password registration failed", { code: detail.code ?? detail.cause?.code });
    return NextResponse.json({ success: false, message: "마스터 비밀번호를 등록하지 못했습니다." },
      { status: 503, headers: noStore });
  }
}
