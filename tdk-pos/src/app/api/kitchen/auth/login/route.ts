import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, staff, staffSessions } from "@/db/schema";
import { createSessionToken, hashSessionToken, verifyKdsPin } from "@/lib/auth";
import { clearKdsLoginAttempts, reserveKdsLoginAttempt } from "@/lib/kds-login-limit";
import { KDS_SESSION_COOKIE_NAME, kdsSessionCookieOptions } from "@/lib/kds-auth";

const failure = (status = 401) => NextResponse.json(
  { success: false, message: status === 429 ? "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." : "직원 ID 또는 KDS PIN을 확인해 주세요." },
  { status, headers: { "Cache-Control": "no-store" } },
);

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { employeeId?: unknown; pin?: unknown } | null;
  const employeeId = typeof body?.employeeId === "string" ? body.employeeId.trim() : "";
  const pin = typeof body?.pin === "string" ? body.pin : "";
  if (!employeeId || employeeId.length > 30 || !/^\d{6}$/.test(pin) || employeeId === "000") return failure();

  try {
    const [candidate] = await db.select({ staffId: staff.staffId, kdsPinHash: staff.kdsPinHash, isActive: staff.isActive, kdsEnabled: staff.kdsEnabled })
      .from(staff).where(eq(staff.staffCode, employeeId)).limit(1);
    if (!await reserveKdsLoginAttempt(candidate?.staffId ?? null, employeeId)) return failure(429);
    const valid = Boolean(candidate && candidate.isActive === 1 && candidate.kdsEnabled === 1 && await verifyKdsPin(pin, candidate.kdsPinHash));

    await db.insert(auditLogs).values({
      staffId: candidate?.staffId ?? null,
      actionType: valid ? "KDS_LOGIN_SUCCESS" : "KDS_LOGIN_FAILED",
      entityType: "KDS_AUTH",
      entityId: candidate?.staffId ?? null,
      description: `employeeId=${employeeId}`,
    });

    if (!candidate || !valid) return failure();

    const token = createSessionToken();
    await db.insert(staffSessions).values({
      staffId: candidate.staffId,
      sessionTokenHash: hashSessionToken(token),
      sessionType: "KDS",
      status: "ACTIVE",
    });
    await clearKdsLoginAttempts(candidate.staffId);
    const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(KDS_SESSION_COOKIE_NAME, token, kdsSessionCookieOptions);
    return response;
  } catch (error) {
    console.error("KDS staff login failed", error);
    return NextResponse.json({ success: false, message: "KDS login failed. Please retry." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
