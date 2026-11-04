import "server-only";

import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/db";
import { auditLogs, programTrustTokens, staff, staffSessions } from "@/db/schema";
import { verifyMasterPassword } from "@/lib/master-password";
import { clearAdminAuthFailures, isAdminAuthAttemptAllowed, recordAdminAuthFailure,
  reserveAdminStatusAttempt } from "@/lib/admin-auth-limit";
import { isHttpsSameOriginRequest } from "@/lib/kds-device";
import { getKdsRateLimitIp } from "@/lib/kds-network-server";
import { programTrustClientLabel } from "@/lib/program-trust-client-label";
import { getCurrentProgramTrust, hashProgramTrustToken, isSecureTrustRequest, newProgramTrustToken,
  programCookieName, programPermission, tokenCookieName, trustCookieOptions, type Program } from "@/lib/program-trust";

const noStore = { "Cache-Control": "no-store" };
const invalid = () => NextResponse.json({ success: false,
  message: "ID 또는 마스터 비밀번호를 확인해 주세요. 비밀번호 미설정 계정은 관리자에게 설정 절차를 요청해 주세요." },
{ status: 401, headers: noStore });

async function invalidIdStatus(program: Program) {
  const allowed = await reserveAdminStatusAttempt(`id-status-${program.toLowerCase()}`,
    await getKdsRateLimitIp());
  return allowed === false
    ? NextResponse.json({ success: false, trusted: false,
      message: "ID 상태 조회 요청이 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: noStore })
    : NextResponse.json({ success: false, trusted: false,
      message: "등록된 ID를 확인할 수 없습니다. ID를 다시 확인해 주세요." }, { status: 403, headers: noStore });
}

export async function trustStatus(program: Program, request?: Request) {
  try {
    const loginId = request ? new URL(request.url).searchParams.get("loginId") : null;
    let passwordRegistrationAllowed = false;
    let posAccount: { staffId: number; loginId: string; passwordHash: string | null;
      passwordChangeRequired: number; pinHash: string | null } | undefined;
    if (program === "POS" && loginId !== null) {
      const normalizedId = loginId.trim().toLowerCase();
      if (!/^[a-z][a-z0-9._-]{2,31}$/.test(normalizedId))
        return invalidIdStatus(program);
      const candidates = await db.select({ staffId: staff.staffId, loginId: staff.adminLoginId,
        passwordHash: staff.securityPasswordHash,
        passwordChangeRequired: staff.securityPasswordChangeRequired, pinHash: staff.employeePinHash,
      }).from(staff).where(and(sql`LOWER(${staff.adminLoginId}) = ${normalizedId}`,
        eq(staff.isActive, 1), isNull(staff.terminatedAt), eq(staff.posEnabled, 1), ne(staff.staffCode, "000"),
      )).limit(2);
      if (candidates.length !== 1 || !candidates[0].loginId)
        return invalidIdStatus(program);
      const eligible = candidates[0] as NonNullable<typeof posAccount>;
      posAccount = eligible;
      passwordRegistrationAllowed = eligible.passwordHash === null && eligible.passwordChangeRequired === 1;
    }
    if (program === "ADM" && loginId !== null) {
      const normalizedId = loginId.trim().toLowerCase();
      const [eligible] = /^[a-z][a-z0-9._-]{2,31}$/.test(normalizedId)
        ? await db.select({ staffId: staff.staffId }).from(staff).where(and(
          sql`LOWER(${staff.adminLoginId}) = ${normalizedId}`, eq(staff.isActive, 1),
          eq(staff.adminEnabled, 1), isNull(staff.terminatedAt), ne(staff.staffCode, "000"))).limit(1)
        : [];
      if (!eligible) {
        const allowed = await reserveAdminStatusAttempt("id-status-adm-invalid", await getKdsRateLimitIp());
        if (allowed === false) return NextResponse.json({ success: false, trusted: false,
          message: "ID 상태 조회 요청이 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: noStore });
        return NextResponse.json({ success: false, trusted: false,
          message: "등록된 ID 또는 ADM 접근 권한을 확인해 주세요." }, { status: 403, headers: noStore });
      }
    }
    if (program === "KDS" && loginId !== null) {
      if (!/^[a-z][a-z0-9._-]{2,31}$/i.test(loginId))
        return invalidIdStatus(program);
      const [eligible] = await db.select({ staffId: staff.staffId,
        passwordHash: staff.securityPasswordHash,
        passwordChangeRequired: staff.securityPasswordChangeRequired }).from(staff).where(and(
        sql`LOWER(${staff.adminLoginId}) = ${loginId.trim().toLowerCase()}`,
        eq(staff.isActive, 1), isNull(staff.terminatedAt), eq(staff.kdsEnabled, 1), ne(staff.staffCode, "000"),
      )).limit(1);
      if (!eligible) {
        return invalidIdStatus(program);
      }
      passwordRegistrationAllowed = eligible.passwordHash === null && eligible.passwordChangeRequired === 1;
    }
    if (program === "HOS" && loginId !== null) {
      const normalizedId = loginId.trim().toLowerCase();
      const [eligible] = /^[a-z][a-z0-9._-]{2,31}$/.test(normalizedId)
        ? await db.select({ staffId: staff.staffId, passwordHash: staff.securityPasswordHash,
          passwordChangeRequired: staff.securityPasswordChangeRequired }).from(staff).where(and(
          sql`LOWER(${staff.adminLoginId}) = ${normalizedId}`,
          eq(staff.isActive, 1), isNull(staff.terminatedAt), eq(staff.hosEnabled, 1),
          ne(staff.staffCode, "000"))).limit(1)
        : [];
      if (!eligible) return invalidIdStatus(program);
      passwordRegistrationAllowed = eligible.passwordHash === null && eligible.passwordChangeRequired === 1;
    }
    const trust = await getCurrentProgramTrust(program, loginId ? { loginId } : undefined);
    const usableTrust = program === "POS" && posAccount &&
      (!posAccount.passwordHash || posAccount.passwordChangeRequired === 1) ? null : trust;
    const store = await cookies();
    const hadCookie = store.getAll().some(item => item.name === programCookieName[program] ||
      item.name.startsWith(`${programCookieName[program]}_`));
    const [member] = usableTrust ? await db.select({ loginId: staff.adminLoginId,
      pinHash: staff.employeePinHash }).from(staff).where(eq(staff.staffId, usableTrust.enrolledByStaffId)).limit(1) : [];
    const response = NextResponse.json({ success: true, trusted: Boolean(usableTrust),
      passwordRegistrationRequired: Boolean((program === "KDS" || program === "POS" || program === "HOS") && !usableTrust &&
        loginId && passwordRegistrationAllowed),
      ...((program === "POS" || program === "HOS") && loginId ? { masterPasswordConfigured: !passwordRegistrationAllowed } : {}),
      invalidated: !usableTrust && hadCookie, pinSetupRequired: Boolean(usableTrust && !member?.pinHash),
      loginId: usableTrust ? member?.loginId : undefined }, { headers: noStore });
    if (usableTrust) {
      const token = (await cookies()).get(usableTrust.cookieName)?.value;
      if (token) response.cookies.set(usableTrust.cookieName, token, trustCookieOptions);
    }
    return response;
  } catch (error) {
    console.error("Program trust status unavailable", { program, code: (error as { code?: string }).code });
    return NextResponse.json({ success: false, message: "인증 상태를 확인할 수 없습니다." }, { status: 503, headers: noStore });
  }
}

export async function enrollProgramTrust(request: Request, program: Program) {
  if (!isHttpsSameOriginRequest(request) || !isSecureTrustRequest(request)) {
    return NextResponse.json({ success: false, message: "HTTPS 접속이 필요합니다." }, { status: 403, headers: noStore });
  }
  const body = await request.json().catch(() => null) as {
    loginId?: unknown; password?: unknown; standalone?: unknown;
  } | null;
  const loginId = typeof body?.loginId === "string" ? body.loginId.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(loginId) || password.length < 10 || password.length > 128) return invalid();
  const ip = await getKdsRateLimitIp();
  const limitScope = "master-password";
  let stage = "rate_limit";
  try {
    stage = "employee_lookup";
    const [candidate] = await db.select({ staffId: staff.staffId, pinHash: staff.employeePinHash,
      passwordHash: staff.securityPasswordHash, passwordChangeRequired: staff.securityPasswordChangeRequired,
    }).from(staff).where(and(sql`LOWER(${staff.adminLoginId}) = ${loginId}`,
      eq(staff.isActive, 1), isNull(staff.terminatedAt), eq(programPermission(program), 1),
      ne(staff.staffCode, "000"))).limit(1);
    if (!candidate) {
      const abuseLimit = await reserveAdminStatusAttempt(`master-auth-invalid-${program.toLowerCase()}`, ip);
      if (abuseLimit === false) return NextResponse.json({ success: false,
        message: "인증 요청이 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: noStore });
      return invalid();
    }
    const account = String(candidate.staffId);
    if (!candidate.passwordHash && candidate.passwordChangeRequired === 1)
      return NextResponse.json({ success: true, passwordRegistrationRequired: true }, { headers: noStore });
    if (!candidate.passwordHash) return invalid();
    if (!await isAdminAuthAttemptAllowed(limitScope, account, ip)) {
      return NextResponse.json({ success: false, message: "인증 시도가 많습니다. 15분 후 다시 시도해 주세요." }, { status: 429, headers: noStore });
    }
    if (candidate.passwordChangeRequired === 1) {
      await clearAdminAuthFailures(limitScope, account, ip);
      return NextResponse.json({ success: true, passwordRegistrationRequired: true }, { headers: noStore });
    }
    stage = "password_verify";
    if (!await verifyMasterPassword(candidate.staffId, password)) {
      const allowed = await recordAdminAuthFailure(limitScope, account, ip);
      return allowed ? invalid() : NextResponse.json({
        success: false, message: "인증 시도가 많습니다. 15분 후 다시 시도해 주세요.",
      }, { status: 429, headers: noStore });
    }
    if (candidate.passwordChangeRequired === 1) {
      await clearAdminAuthFailures(limitScope, account, ip);
      return NextResponse.json({ success: true, passwordChangeRequired: true }, { headers: noStore });
    }
    stage = "token_create";
    const token = newProgramTrustToken();
    const tokenId = await db.transaction(async tx => {
      const inserted = await tx.insert(programTrustTokens).values({
        program, tokenHash: hashProgramTrustToken(token), enrolledByStaffId: candidate.staffId,
        clientLabel: programTrustClientLabel(request, body?.standalone === true),
      });
      await tx.insert(auditLogs).values({ staffId: candidate.staffId,
        actionType: "PROGRAM_TRUST_ENROLLED", entityType: "PROGRAM_TRUST",
        description: `program=${program}` });
      return Number(inserted[0].insertId);
    });
    stage = "clear_attempts";
    await clearAdminAuthFailures(limitScope, account, ip);
    const response = NextResponse.json({ success: true,
      pinSetupRequired: !candidate.pinHash, loginId }, { headers: noStore });
    response.cookies.set(tokenCookieName(program, tokenId), token, trustCookieOptions);
    return response;
  } catch (error) {
    const detail = error as { name?: string; code?: string; cause?: { code?: string } };
    console.error("Program trust enrollment unavailable", { program, stage, name: detail.name,
      code: detail.code ?? detail.cause?.code });
    return NextResponse.json({ success: false, message: "인증 서비스를 이용할 수 없습니다." }, { status: 503, headers: noStore });
  }
}

export async function revokeCurrentProgramTrust(request: Request, program: Program) {
  if (!isHttpsSameOriginRequest(request)) return NextResponse.json({ success: false }, { status: 403, headers: noStore });
  try {
    const trusted = await getCurrentProgramTrust(program);
    if (!trusted) return NextResponse.json({ success: false }, { status: 401, headers: noStore });
    await db.transaction(async tx => {
      await tx.update(programTrustTokens).set({ revokedAt: new Date(), revokeReason: "SELF_REVOKED" }).where(and(
        eq(programTrustTokens.tokenId, trusted.tokenId), eq(programTrustTokens.program, program)));
      await tx.update(staffSessions).set({ status: "LOGGED_OUT", loggedOutAt: new Date(), ownerReauthenticatedAt: null })
        .where(and(eq(staffSessions.trustTokenId, trusted.tokenId), eq(staffSessions.status, "ACTIVE")));
      await tx.insert(auditLogs).values({ staffId: trusted.enrolledByStaffId,
        actionType: "PROGRAM_TRUST_REVOKED", entityType: "PROGRAM_TRUST", entityId: trusted.tokenId,
        description: `program=${program}` });
    });
    const response = NextResponse.json({ success: true }, { headers: noStore });
    response.cookies.set(trusted.cookieName, "", { ...trustCookieOptions, maxAge: 0 });
    return response;
  } catch (error) {
    console.error("Program trust revocation unavailable", { program, code: (error as { code?: string }).code });
    return NextResponse.json({ success: false }, { status: 503, headers: noStore });
  }
}
