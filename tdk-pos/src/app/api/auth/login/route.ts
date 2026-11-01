import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { programTrustTokens, staff, staffSessions } from "@/db/schema";
import { createSessionToken, hashSessionToken, sessionCookieOptions, SESSION_COOKIE_NAME, verifyEmployeePin } from "@/lib/auth";
import { clearAdminAuthFailures, isAdminAuthAttemptAllowed, recordAdminAuthFailure } from "@/lib/admin-auth-limit";
import { getKdsRateLimitIp } from "@/lib/kds-network-server";
import { isValidEmployeePin } from "@/lib/pin";
import { getCurrentProgramTrust } from "@/lib/program-trust";

const invalid = () => NextResponse.json({ success: false, message: "직원 또는 PIN을 확인해 주세요." }, { status: 401, headers: { "Cache-Control": "no-store" } });
const rateLimited = () => NextResponse.json({ success: false, message: "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." }, { status: 429, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  try {
    const body = await request.json() as { loginId?: unknown; pin?: unknown };
    const loginId = typeof body.loginId === "string" ? body.loginId.trim().toLowerCase() : "";
    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!/^[a-z][a-z0-9._-]{2,31}$/.test(loginId) || !isValidEmployeePin(pin)) return invalid();
    const trust = await getCurrentProgramTrust("POS", { loginId });
    if (!trust) return NextResponse.json({ success: false, code: "TRUST_REQUIRED",
      message: "먼저 ID와 마스터 비밀번호로 인증해 주세요." }, { status: 403 });

    const [member] = await db.select({ staffId: staff.staffId, staffCode: staff.staffCode, isActive: staff.isActive,
      posEnabled: staff.posEnabled, employeePinHash: staff.employeePinHash })
      .from(staff).where(and(sql`LOWER(${staff.adminLoginId}) = ${loginId}`, eq(staff.isActive, 1),
        isNull(staff.terminatedAt))).limit(1);
    if (!member) return invalid();
    if (member.staffCode === "000") return NextResponse.json({ success: false, message: "개인 직원 계정으로 로그인해 주세요." }, { status: 403 });
    if (member.posEnabled !== 1) return NextResponse.json({ success: false, message: "이 직원에게 POS 사용 권한이 없습니다." }, { status: 403 });
    if (!member.employeePinHash) return NextResponse.json({ success: false, message: "개인 PIN이 설정되지 않았습니다. 최초 인증 화면에서 본인이 설정해 주세요.", code: "EMPLOYEE_PIN_NOT_CONFIGURED" }, { status: 403 });
    const ip = await getKdsRateLimitIp();
    const account = String(member.staffId);
    const failureScope = "employee-pin";
    if (!await isAdminAuthAttemptAllowed(failureScope, account, ip)) return rateLimited();
    if (!await verifyEmployeePin(pin, member.employeePinHash)) {
      return await recordAdminAuthFailure(failureScope, account, ip) ? invalid() : rateLimited();
    }

    const token = createSessionToken();
    await db.insert(staffSessions).values({ staffId: member.staffId, trustTokenId: trust.tokenId,
      sessionTokenHash: hashSessionToken(token), sessionType: "POS", status: "ACTIVE" });
    await db.update(programTrustTokens).set({ lastUsedAt: new Date() }).where(eq(programTrustTokens.tokenId, trust.tokenId));
    await clearAdminAuthFailures(failureScope, account, ip);
    const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions);
    return response;
  } catch (error) {
    const detail = error as { code?: string; cause?: { code?: string } };
    console.error("POS staff login unavailable", { code: detail?.code ?? detail?.cause?.code });
    return NextResponse.json({ success: false, message: "로그인 서비스를 이용할 수 없습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
