import { NextResponse } from "next/server";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, programTrustTokens, staff, staffSessions } from "@/db/schema";
import { hashSessionToken, verifyEmployeePin } from "@/lib/auth";
import { ADMIN_SESSION_COOKIE_NAME, adminSessionCookieOptions, createAdminSessionToken } from "@/lib/admin-auth";
import { clearAdminAuthFailures, isAdminAuthAttemptAllowed, recordAdminAuthFailure } from "@/lib/admin-auth-limit";
import { getKdsRateLimitIp } from "@/lib/kds-network-server";
import { getCurrentProgramTrust } from "@/lib/program-trust";
import { isValidEmployeePin } from "@/lib/pin";

const failure = () => NextResponse.json({ success: false, message: "직원 또는 PIN을 확인해 주세요." }, { status: 401 });

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const input = await request.json();
    body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  } catch { return failure(); }

  const loginId = typeof body.loginId === "string" ? body.loginId.trim().toLowerCase() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(loginId) || !isValidEmployeePin(pin)) return failure();
  const ip = await getKdsRateLimitIp();
  try {
    const trust = await getCurrentProgramTrust("ADM", { loginId });
    if (!trust) return NextResponse.json({ success: false, code: "TRUST_REQUIRED",
      message: "먼저 ID와 마스터 비밀번호로 인증해 주세요." }, { status: 403 });
    const [candidate] = await db.select({ staffId: staff.staffId, employeePinHash: staff.employeePinHash }).from(staff).where(and(
      sql`LOWER(${staff.adminLoginId}) = ${loginId}`,
      eq(staff.isActive, 1),
      isNull(staff.terminatedAt),
      eq(staff.adminEnabled, 1),
      ne(staff.staffCode, "000"),
    )).limit(1);
    if (candidate && !candidate.employeePinHash) {
      return NextResponse.json({ success: false, code: "EMPLOYEE_PIN_NOT_CONFIGURED", message: "개인 PIN이 설정되지 않았습니다. 최초 인증 화면에서 본인이 설정해 주세요." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    if (!candidate) return failure();
    const failureScope = "employee-pin";
    const account = String(candidate.staffId);
    if (!await isAdminAuthAttemptAllowed(failureScope, account, ip))
      return NextResponse.json({ success: false, message: "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." }, { status: 429 });
    const validPin = candidate?.employeePinHash && await verifyEmployeePin(pin, candidate.employeePinHash);
    if (!validPin) {
      const allowed = await recordAdminAuthFailure(failureScope, account, ip);
      await db.insert(auditLogs).values({ staffId: candidate.staffId, actionType: "ADM_LOGIN_FAILED", entityType: "ADMIN_SESSION" }).catch(() => undefined);
      if (!allowed) return NextResponse.json({ success: false, message: "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." }, { status: 429 });
      return failure();
    }

    const token = createAdminSessionToken();
    await db.transaction(async tx => {
      await tx.insert(staffSessions).values({ staffId: candidate.staffId, trustTokenId: trust.tokenId,
        sessionTokenHash: hashSessionToken(token), sessionType: "ADMIN", status: "ACTIVE" });
      await tx.insert(auditLogs).values({ staffId: candidate.staffId, actionType: "ADM_LOGIN_SUCCEEDED", entityType: "ADMIN_SESSION" });
      await tx.update(programTrustTokens).set({ lastUsedAt: new Date() }).where(eq(programTrustTokens.tokenId, trust.tokenId));
    });
    await clearAdminAuthFailures(failureScope, account, ip);
    const response = NextResponse.json({ success: true });
    response.cookies.set(ADMIN_SESSION_COOKIE_NAME, token, adminSessionCookieOptions);
    return response;
  } catch (error) {
    const detail = error as { code?: string; cause?: { code?: string } };
    console.error("Admin center login failed", { code: detail?.code ?? detail?.cause?.code });
    return NextResponse.json({ success: false, message: "관리센터 로그인에 실패했습니다." }, { status: 500 });
  }
}
