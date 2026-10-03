import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { staff, staffSessions } from "@/db/schema";
import { hashSessionToken, isValidAdminPin, verifyAdminPin } from "@/lib/auth";
import { ADMIN_SESSION_COOKIE_NAME, adminSessionCookieOptions, createAdminSessionToken, isValidAdminLoginId, normalizeAdminLoginId } from "@/lib/admin-auth";
import { clearAdminLoginAttempts, reserveAdminLoginAttempt } from "@/lib/admin-login-limit";

const failure = () => NextResponse.json({ success: false, message: "아이디 또는 PIN을 확인해 주세요." }, { status: 401 });

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const input = await request.json();
    body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  } catch { return failure(); }

  const loginId = normalizeAdminLoginId(body.loginId);
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!isValidAdminLoginId(loginId) || !isValidAdminPin(pin)) return failure();
  if (!reserveAdminLoginAttempt(loginId)) {
    return NextResponse.json({ success: false, message: "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." }, { status: 429 });
  }

  try {
    const [candidate] = await db.select({ staffId: staff.staffId, adminPinHash: staff.adminPinHash }).from(staff).where(and(
      eq(staff.adminLoginId, loginId),
      eq(staff.isActive, 1),
      eq(staff.role, "OWNER"),
      ne(staff.staffCode, "000"),
    )).limit(1);
    if (!candidate || !(await verifyAdminPin(pin, candidate.adminPinHash))) return failure();

    const token = createAdminSessionToken();
    await db.insert(staffSessions).values({ staffId: candidate.staffId, sessionTokenHash: hashSessionToken(token), status: "ACTIVE" });
    clearAdminLoginAttempts(loginId);
    const response = NextResponse.json({ success: true });
    response.cookies.set(ADMIN_SESSION_COOKIE_NAME, token, adminSessionCookieOptions);
    return response;
  } catch (error) {
    console.error("Admin center login failed", error);
    return NextResponse.json({ success: false, message: "관리센터 로그인에 실패했습니다." }, { status: 500 });
  }
}
