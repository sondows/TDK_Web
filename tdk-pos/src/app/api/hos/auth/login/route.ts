import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, programTrustTokens, staff, staffSessions } from "@/db/schema";
import { createSessionToken, hashSessionToken, verifyEmployeePin } from "@/lib/auth";
import { clearAdminAuthFailures, isAdminAuthAttemptAllowed, recordAdminAuthFailure } from "@/lib/admin-auth-limit";
import { getCurrentProgramTrust } from "@/lib/program-trust";
import { getKdsRateLimitIp } from "@/lib/kds-network-server";
import { isSameOriginRequest, kdsCookieSecureForRequest } from "@/lib/kds-device";
import { HOS_SESSION_COOKIE_NAME, hosSessionCookieOptions } from "@/lib/hos-auth";

const invalid = (status = 401) => NextResponse.json({ success: false,
  message: "직원 ID 또는 PIN을 확인해 주세요." }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return invalid(403);
  const body = await request.json().catch(() => null) as { loginId?: unknown; pin?: unknown } | null;
  const loginId = typeof body?.loginId === "string" ? body.loginId.trim().toLowerCase() : "";
  const pin = typeof body?.pin === "string" ? body.pin : "";
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(loginId) || !/^\d{6}$/.test(pin)) return invalid();
  let stage = "trust_check";
  try {
    const trust = await getCurrentProgramTrust("HOS", { loginId });
    if (!trust) return NextResponse.json({ success: false, code: "TRUST_REQUIRED",
      message: "먼저 마스터 비밀번호로 인증해 주세요." }, { status: 403 });
    stage = "employee_lookup";
    const rows = await db.select({ staffId: staff.staffId, employeePinHash: staff.employeePinHash,
      staffCode: staff.staffCode, isActive: staff.isActive, hosEnabled: staff.hosEnabled,
    }).from(staff).where(and(sql`LOWER(${staff.adminLoginId}) = ${loginId}`, isNull(staff.terminatedAt))).limit(2);
    const member = rows.length === 1 ? rows[0] : null;
    if (!member || member.isActive !== 1 || member.staffCode === "000") return invalid();
    if (member.hosEnabled !== 1) return invalid(403);
    if (!member.employeePinHash) return NextResponse.json({ success: false,
      code: "EMPLOYEE_PIN_NOT_CONFIGURED", message: "개인 PIN이 등록되지 않았습니다." }, { status: 403 });
    const ip = await getKdsRateLimitIp();
    const account = String(member.staffId);
    const scope = "employee-pin";
    if (!await isAdminAuthAttemptAllowed(scope, account, ip)) return invalid(429);
    stage = "pin_verify";
    if (!await verifyEmployeePin(pin, member.employeePinHash)) {
      const allowed = await recordAdminAuthFailure(scope, account, ip);
      await db.insert(auditLogs).values({ staffId: member.staffId, actionType: "HOS_LOGIN_FAILED",
        entityType: "HOS_AUTH", entityId: member.staffId, description: "invalid PIN" });
      return invalid(allowed ? 401 : 429);
    }
    await clearAdminAuthFailures(scope, account, ip);
    const token = createSessionToken();
    await db.insert(staffSessions).values({ staffId: member.staffId, trustTokenId: trust.tokenId,
      sessionTokenHash: hashSessionToken(token), sessionType: "HOS", status: "ACTIVE" });
    await db.update(programTrustTokens).set({ lastUsedAt: new Date() })
      .where(eq(programTrustTokens.tokenId, trust.tokenId));
    await db.insert(auditLogs).values({ staffId: member.staffId, actionType: "HOS_LOGIN_SUCCESS",
      entityType: "HOS_AUTH", entityId: member.staffId, description: "programTrust=yes" });
    const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(HOS_SESSION_COOKIE_NAME, token,
      { ...hosSessionCookieOptions, secure: kdsCookieSecureForRequest(request) });
    return response;
  } catch (error) {
    const detail = error as { code?: string; cause?: { code?: string } };
    console.error("HOS employee login unavailable", { stage, code: detail.code ?? detail.cause?.code });
    return NextResponse.json({ success: false, code: "HOS_AUTH_UNAVAILABLE",
      message: "HOS 인증 서비스를 사용할 수 없습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
