import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, programTrustTokens, staff, staffSessions } from "@/db/schema";
import { createSessionToken, hashSessionToken, verifyEmployeePin } from "@/lib/auth";
import { clearAdminAuthFailures, isAdminAuthAttemptAllowed, recordAdminAuthFailure } from "@/lib/admin-auth-limit";
import { KDS_SESSION_COOKIE_NAME, kdsSessionCookieOptions } from "@/lib/kds-auth";
import { kdsCookieSecureForRequest, isSameOriginRequest } from "@/lib/kds-device";
import { getCurrentProgramTrust } from "@/lib/program-trust";
import { getKdsRateLimitIp } from "@/lib/kds-network-server";
import { getKdsAuthSchemaError, getKdsForeignKeyViolation } from "@/lib/kds-auth-errors";

const failure = (status = 401, message = "Employee ID or KDS PIN is incorrect.", code?: string) => NextResponse.json(
  { success: false, message, code }, { status, headers: { "Cache-Control": "no-store" } },
);
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return failure(403, "Request origin could not be verified.");
  const body = await request.json().catch(() => null) as { loginId?: unknown; pin?: unknown } | null;
  const loginId = typeof body?.loginId === "string" ? body.loginId.trim().toLowerCase() : "";
  const pin = typeof body?.pin === "string" ? body.pin : "";
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(loginId)) return failure();
  if (!/^\d{6}$/.test(pin)) return failure();
  let authStage = "trust_check";
  try {
    const trust = await getCurrentProgramTrust("KDS", { loginId });
    if (!trust) return failure(403, "먼저 ID와 마스터 비밀번호로 인증해 주세요.", "TRUST_REQUIRED");
    authStage = "employee_lookup";
    const candidates = await db.select({
      staffId: staff.staffId, employeePinHash: staff.employeePinHash,
      isActive: staff.isActive, kdsEnabled: staff.kdsEnabled,
      staffCode: staff.staffCode,
    }).from(staff).where(and(sql`LOWER(${staff.adminLoginId}) = ${loginId}`,
      isNull(staff.terminatedAt))).limit(2);
    const candidate = candidates.length === 1 ? candidates[0] : null;
    if (!candidate || Number(candidate.isActive) !== 1 || candidate.staffCode === "000") {
      return failure(401, "Employee ID or KDS PIN is incorrect.");
    }
    if (Number(candidate.kdsEnabled) !== 1)
      return failure(403, "KDS access is not enabled for this employee. Contact an administrator.", "KDS_PERMISSION_DENIED");
    if (!candidate.employeePinHash) return failure(403, "개인 PIN이 설정되지 않았습니다. 최초 인증 화면에서 본인이 설정해 주세요.", "EMPLOYEE_PIN_NOT_CONFIGURED");
    authStage = "employee_attempt_limit";
    const failureScope = "employee-pin";
    const account = String(candidate.staffId);
    const ip = await getKdsRateLimitIp();
    if (!await isAdminAuthAttemptAllowed(failureScope, account, ip))
      return failure(429, "Too many attempts. Try again in 15 minutes.", "KDS_EMPLOYEE_RATE_LIMIT");
    authStage = "common_pin_verification";
    const pinMatches = await verifyEmployeePin(pin, candidate.employeePinHash);
    if (!pinMatches) {
      const allowed = await recordAdminAuthFailure(failureScope, account, ip);
      await db.insert(auditLogs).values({ staffId: candidate.staffId, actionType: "KDS_LOGIN_FAILED", entityType: "KDS_AUTH", entityId: candidate.staffId, description: "invalid PIN" });
      return allowed ? failure() : failure(429, "Too many attempts. Try again in 15 minutes.", "KDS_EMPLOYEE_RATE_LIMIT");
    }
    authStage = "clear_login_attempts";
    await clearAdminAuthFailures(failureScope, account, ip);
    authStage = "login_audit";
    await db.insert(auditLogs).values({
      staffId: candidate.staffId, actionType: "KDS_LOGIN_SUCCESS",
      entityType: "KDS_AUTH", entityId: candidate.staffId,
      description: `staffId=${candidate.staffId}; programTrust=yes`,
    });
    const token = createSessionToken();
    authStage = "session_create";
    await db.insert(staffSessions).values({
      staffId: candidate.staffId, trustTokenId: trust.tokenId,
      sessionTokenHash: hashSessionToken(token), sessionType: "KDS", status: "ACTIVE",
    });
    await db.update(programTrustTokens).set({ lastUsedAt: new Date() }).where(eq(programTrustTokens.tokenId, trust.tokenId));
    const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(KDS_SESSION_COOKIE_NAME, token, { ...kdsSessionCookieOptions, secure: kdsCookieSecureForRequest(request) });
    return response;
  } catch (error) {
    const detail = error as { name?: string; code?: string; cause?: { code?: string } };
    const schemaError = getKdsAuthSchemaError(error);
    const foreignKeyError = getKdsForeignKeyViolation(error);
    console.error("KDS staff login failed", {
      stage: authStage,
      dbName: process.env.DB_NAME || "unset",
      category: schemaError ? "schema_mismatch" : "service_unavailable",
      name: schemaError?.name ?? detail?.name,
      code: schemaError?.code ?? detail?.code ?? detail?.cause?.code,
      ...(foreignKeyError ? { foreignKey: foreignKeyError } : {}),
    });
    if (schemaError) return NextResponse.json({
      success: false, code: "KDS_AUTH_SCHEMA_MISMATCH",
      message: "KDS authentication configuration needs administrator review.",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({
      success: false, code: "KDS_AUTH_UNAVAILABLE",
      message: "KDS authentication is temporarily unavailable. Try again later or contact an administrator.",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
