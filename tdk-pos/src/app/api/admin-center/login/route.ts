import { NextResponse } from "next/server";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, staff, staffSessions } from "@/db/schema";
import { hashSessionToken, verifyEmployeePin } from "@/lib/auth";
import { ADMIN_SESSION_COOKIE_NAME, adminSessionCookieOptions, createAdminSessionToken } from "@/lib/admin-auth";
import { clearAdminAuthFailures, isAdminAuthAttemptAllowed, recordAdminAuthFailure } from "@/lib/admin-auth-limit";
import { getKdsRateLimitIp } from "@/lib/kds-network-server";
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
    if (!await isAdminAuthAttemptAllowed("adm-login", loginId, ip)) return NextResponse.json({ success: false, message: "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." }, { status: 429 });
    const [candidate] = await db.select({ staffId: staff.staffId, employeePinHash: staff.employeePinHash }).from(staff).where(and(
      sql`LOWER(${staff.adminLoginId}) = ${loginId}`,
      eq(staff.isActive, 1),
      eq(staff.adminEnabled, 1),
      ne(staff.staffCode, "000"),
    )).limit(1);
    if (candidate && !candidate.employeePinHash) {
      return NextResponse.json({ success: false, code: "EMPLOYEE_PIN_NOT_CONFIGURED", message: "직원 공통 PIN이 설정되지 않았습니다. 관리자에게 PIN 설정을 요청해 주세요." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const validPin = candidate?.employeePinHash && await verifyEmployeePin(pin, candidate.employeePinHash);
    if (!candidate || !validPin) {
      const allowed = await recordAdminAuthFailure("adm-login", loginId, ip);
      await db.insert(auditLogs).values({ staffId: candidate?.staffId ?? null, actionType: "ADM_LOGIN_FAILED", entityType: "ADMIN_SESSION" }).catch(() => undefined);
      if (!allowed) return NextResponse.json({ success: false, message: "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." }, { status: 429 });
      return failure();
    }

    const token = createAdminSessionToken();
    await db.transaction(async tx => {
      await tx.insert(staffSessions).values({ staffId: candidate.staffId, sessionTokenHash: hashSessionToken(token), sessionType: "ADMIN", status: "ACTIVE" });
      await tx.insert(auditLogs).values({ staffId: candidate.staffId, actionType: "ADM_LOGIN_SUCCEEDED", entityType: "ADMIN_SESSION" });
    });
    await clearAdminAuthFailures("adm-login", loginId, ip);
    const response = NextResponse.json({ success: true });
    response.cookies.set(ADMIN_SESSION_COOKIE_NAME, token, adminSessionCookieOptions);
    return response;
  } catch (error) {
    const detail = error as { code?: string; cause?: { code?: string } };
    console.error("Admin center login failed", { code: detail?.code ?? detail?.cause?.code });
    return NextResponse.json({ success: false, message: "관리센터 로그인에 실패했습니다." }, { status: 500 });
  }
}
