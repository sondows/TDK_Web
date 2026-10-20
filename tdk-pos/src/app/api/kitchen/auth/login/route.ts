import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { kdsAccounts, kdsSessions } from "@/db/schema";
import { createSessionToken, hashSessionToken, isValidKdsPin, verifyKdsPin } from "@/lib/auth";
import { clearAdminLoginAttempts, reserveAdminLoginAttempt } from "@/lib/admin-login-limit";
import { isValidKdsLoginId, KDS_SESSION_COOKIE_NAME, kdsSessionCookieOptions, normalizeKdsLoginId } from "@/lib/kds-auth";

const invalid = () => NextResponse.json({ success: false, message: "ID 또는 6자리 번호를 확인해 주세요." }, { status: 401, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { loginId?: unknown; pin?: unknown } | null;
  const loginId = normalizeKdsLoginId(body?.loginId);
  const pin = typeof body?.pin === "string" ? body.pin : "";
  if (!isValidKdsLoginId(loginId) || !isValidKdsPin(pin)) return invalid();
  const attemptKey = `kds:${loginId}`;
  if (!reserveAdminLoginAttempt(attemptKey)) {
    return NextResponse.json({ success: false, message: "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." }, { status: 429 });
  }
  try {
    const [account] = await db.select({ id: kdsAccounts.kdsAccountId, pinHash: kdsAccounts.pinHash })
      .from(kdsAccounts).where(and(eq(kdsAccounts.loginId, loginId), eq(kdsAccounts.isActive, 1))).limit(1);
    if (!account || !(await verifyKdsPin(pin, account.pinHash))) return invalid();
    const token = createSessionToken();
    await db.insert(kdsSessions).values({ kdsAccountId: account.id, sessionTokenHash: hashSessionToken(token) });
    clearAdminLoginAttempts(attemptKey);
    const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(KDS_SESSION_COOKIE_NAME, token, kdsSessionCookieOptions);
    return response;
  } catch (error) {
    console.error("KDS login failed", error);
    return NextResponse.json({ success: false, message: "KDS 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
