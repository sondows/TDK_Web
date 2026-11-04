import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, programTrustTokens, staff, staffSessions } from "@/db/schema";
import { createSessionToken, hashEmployeePin, hashSessionToken, sessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/auth";
import { verifyMasterPassword } from "@/lib/master-password";
import { ADMIN_SESSION_COOKIE_NAME, adminSessionCookieOptions, createAdminSessionToken } from "@/lib/admin-auth";
import { recordAdminAuthFailure, clearAdminAuthFailures, reserveAdminStatusAttempt } from "@/lib/admin-auth-limit";
import { isAcceptableEmployeePin } from "@/lib/employee-pin-policy";
import { isHttpsSameOriginRequest, reserveKdsIpAttempt } from "@/lib/kds-device";
import { getKdsNetworkContext, getKdsRateLimitIp } from "@/lib/kds-network-server";
import { KDS_SESSION_COOKIE_NAME, kdsSessionCookieOptions } from "@/lib/kds-auth";
import { HOS_SESSION_COOKIE_NAME, hosSessionCookieOptions } from "@/lib/hos-auth";
import { kdsCookieSecureForRequest } from "@/lib/kds-device";
import { getCurrentProgramTrust, isProgram, isSecureTrustRequest, programPermission } from "@/lib/program-trust";

const recentlyEnrolledSql = sql<number>`CASE WHEN ${programTrustTokens.createdAt}
  BETWEEN DATE_SUB(NOW(), INTERVAL 10 MINUTE) AND NOW() THEN 1 ELSE 0 END`;

export async function POST(request: Request) {
  if (!isHttpsSameOriginRequest(request) || !isSecureTrustRequest(request))
    return Response.json({ success: false }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const program = body?.program;
  const loginId = typeof body?.loginId === "string" ? body.loginId.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const pin = body?.pin;
  if (!isProgram(program) || !/^[a-z][a-z0-9._-]{2,31}$/.test(loginId) ||
    password.length > 128 || (password && password.length < 10) || pin !== body?.confirmPin ||
    !isAcceptableEmployeePin(pin))
    return Response.json({ success: false, message: "입력 정보 또는 PIN 형식을 확인해 주세요. 연속·반복 번호는 사용할 수 없습니다." },
      { status: 400 });
  const ip = await getKdsRateLimitIp();
  const scope = "master-password";
  try {
    if (program === "KDS") {
      const ipLimit = await reserveKdsIpAttempt("pin-setup");
      if (ipLimit === "ip-unavailable") return Response.json({ success: false,
        code: "KDS_RATE_LIMIT_IP_UNAVAILABLE", message: "KDS 로그인 네트워크를 확인할 수 없습니다. 연결 설정을 확인해 주세요." },
      { status: 503 });
      if (ipLimit !== "allowed") return Response.json({ success: false,
        code: ipLimit === "network-limited" ? "KDS_NETWORK_RATE_LIMIT" : "KDS_PIN_SETUP_RATE_LIMIT",
        message: ipLimit === "network-limited" ? "이 네트워크에서 KDS 로그인 요청이 많습니다. 잠시 후 다시 시도해 주세요."
          : "KDS PIN 설정 요청이 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429 });
    } else if (await reserveAdminStatusAttempt(`pin-setup-${program.toLowerCase()}`, ip) === false) {
      return Response.json({ success: false,
        message: "PIN 설정 요청이 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
    }
    const localDevelopment = process.env.NODE_ENV !== "production" &&
      request.headers.get("x-tdk-local-dev") === "1" &&
      /^(localhost|127\.0\.0\.1):\d+$/.test(request.headers.get("host") ?? "");
    if (program === "POS" && !(await getKdsNetworkContext()).isInternal && !localDevelopment)
      return Response.json({ success: false }, { status: 403 });
    const trust = await getCurrentProgramTrust(program, { loginId });
    if (!trust) return Response.json({ success: false, message: "보안 인증이 필요합니다." }, { status: 403 });
    const [member] = await db.select({ staffId: staff.staffId, hash: staff.securityPasswordHash,
      pinHash: staff.employeePinHash }).from(staff).where(and(eq(staff.staffId, trust.enrolledByStaffId),
      eq(staff.isActive, 1), isNull(staff.terminatedAt), ne(staff.staffCode, "000"))).limit(1);
    const [trustRecord] = await db.select({ recentlyEnrolled: recentlyEnrolledSql })
      .from(programTrustTokens).where(and(eq(programTrustTokens.tokenId, trust.tokenId),
        isNull(programTrustTokens.revokedAt))).limit(1);
    const recentlyEnrolled = Number(trustRecord?.recentlyEnrolled) === 1;
    if (!member || (!password && (member.pinHash || !recentlyEnrolled))) {
      return Response.json({ success: false, code: "PIN_SETUP_REAUTH_REQUIRED",
        message: "마스터 비밀번호로 다시 인증한 뒤 PIN을 설정해 주세요." }, { status: 403 });
    }
    const account = String(member.staffId);
    if (password && !await verifyMasterPassword(member.staffId, password)) {
      const allowed = await recordAdminAuthFailure(scope, account, ip);
      return Response.json({ success: false, message: allowed ? "마스터 비밀번호를 확인해 주세요." :
        "시도가 많습니다. 15분 후 다시 시도해 주세요." }, { status: allowed ? 401 : 429 });
    }
    // A first setup cannot overwrite an existing PIN. Explicit reset requires password reauthentication.
    if (member.pinHash && body?.reset !== true)
      return Response.json({ success: false, message: "이미 PIN이 설정되어 있습니다." }, { status: 409 });
    const pinHash = await hashEmployeePin(pin);
    const sessionToken = !member.pinHash ? program === "ADM" ? createAdminSessionToken() : createSessionToken() : null;
    const changed = await db.transaction(async tx => {
      const [current] = await tx.select({ hash: staff.securityPasswordHash,
        pinHash: staff.employeePinHash }).from(staff)
        .where(and(eq(staff.staffId, member.staffId), eq(staff.isActive, 1),
          eq(programPermission(program), 1), isNull(staff.terminatedAt)))
        .limit(1).for("update");
      const [currentTrust] = await tx.select({ revokedAt: programTrustTokens.revokedAt,
        recentlyEnrolled: recentlyEnrolledSql }).from(programTrustTokens)
        .where(eq(programTrustTokens.tokenId, trust.tokenId)).limit(1).for("update");
      if (!current || current.hash !== member.hash || !currentTrust || currentTrust.revokedAt ||
        (current.pinHash && body?.reset !== true) ||
        (!current.pinHash && !password && Number(currentTrust.recentlyEnrolled) !== 1))
        return false;
      await tx.update(staff).set({ employeePinHash: pinHash, kdsPinChangeRequired: 0,
        updatedAt: new Date() }).where(eq(staff.staffId, member.staffId));
      if (sessionToken) {
        await tx.insert(staffSessions).values({ staffId: member.staffId, trustTokenId: trust.tokenId,
          sessionTokenHash: hashSessionToken(sessionToken), sessionType: program === "ADM" ? "ADMIN" : program,
          status: "ACTIVE" });
        await tx.update(programTrustTokens).set({ lastUsedAt: new Date() })
          .where(eq(programTrustTokens.tokenId, trust.tokenId));
      }
      if (current.pinHash) await tx.update(staffSessions).set({ status: "LOGGED_OUT",
        loggedOutAt: new Date(), ownerReauthenticatedAt: null })
        .where(and(eq(staffSessions.staffId, member.staffId), eq(staffSessions.status, "ACTIVE")));
      await tx.insert(auditLogs).values({ staffId: member.staffId,
        actionType: current.pinHash ? "EMPLOYEE_PIN_RESET" : "EMPLOYEE_PIN_INITIALIZED",
        entityType: "STAFF", entityId: member.staffId });
      return true;
    });
    if (!changed) return Response.json({ success: false, message: "계정 상태가 변경됐습니다. 다시 시도해 주세요." }, { status: 409 });
    if (password) await clearAdminAuthFailures(scope, account, ip);
    const response = NextResponse.json({ success: true, sessionCreated: Boolean(sessionToken) },
      { headers: { "Cache-Control": "no-store" } });
    if (sessionToken) {
      if (program === "ADM") response.cookies.set(ADMIN_SESSION_COOKIE_NAME, sessionToken, adminSessionCookieOptions);
      else if (program === "KDS") response.cookies.set(KDS_SESSION_COOKIE_NAME, sessionToken,
        { ...kdsSessionCookieOptions, secure: kdsCookieSecureForRequest(request) });
      else if (program === "HOS") response.cookies.set(HOS_SESSION_COOKIE_NAME, sessionToken,
        { ...hosSessionCookieOptions, secure: kdsCookieSecureForRequest(request) });
      else response.cookies.set(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions);
    }
    return response;
  } catch (error) {
    const detail = error as { code?: string; cause?: { code?: string } };
    console.error("Employee PIN setup unavailable", { code: detail.code ?? detail.cause?.code });
    return Response.json({ success: false, message: "PIN 설정 서비스를 이용할 수 없습니다." }, { status: 503 });
  }
}
