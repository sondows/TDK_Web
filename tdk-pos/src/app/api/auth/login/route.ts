import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminSecurityOwners, managedDevices, staff, staffSessions } from "@/db/schema";
import { createSessionToken, hashSessionToken, sessionCookieOptions, SESSION_COOKIE_NAME, verifyEmployeePin } from "@/lib/auth";
import { clearAdminLoginAttempts, isAdminLoginAttemptAllowed, reserveAdminLoginAttempt } from "@/lib/admin-login-limit";
import { isValidEmployeePin } from "@/lib/pin";
import { getCurrentPosDevice } from "@/lib/kds-device";

const invalid = () => NextResponse.json({ success: false, message: "직원 또는 PIN을 확인해 주세요." }, { status: 401, headers: { "Cache-Control": "no-store" } });
const rateLimited = () => NextResponse.json({ success: false, message: "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." }, { status: 429, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  try {
    const body = await request.json() as { loginId?: unknown; pin?: unknown };
    const loginId = typeof body.loginId === "string" ? body.loginId.trim().toLowerCase() : "";
    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!/^[a-z][a-z0-9._-]{2,31}$/.test(loginId) || !isValidEmployeePin(pin)) return invalid();

    const [member] = await db.select({ staffId: staff.staffId, staffCode: staff.staffCode, isActive: staff.isActive,
      posEnabled: staff.posEnabled, employeePinHash: staff.employeePinHash })
      .from(staff).where(and(sql`LOWER(${staff.adminLoginId}) = ${loginId}`, eq(staff.isActive, 1))).limit(1);
    const identity = member?.staffId ?? loginId;
    const loginKey = `pos-login:${identity}`;
    if (!isAdminLoginAttemptAllowed(loginKey)) return rateLimited();
    if (!member) {
      if (!reserveAdminLoginAttempt(loginKey)) return rateLimited();
      return invalid();
    }
    if (member.staffCode === "000") return NextResponse.json({ success: false, message: "개인 직원 계정으로 로그인해 주세요." }, { status: 403 });
    if (member.posEnabled !== 1) return NextResponse.json({ success: false, message: "이 직원에게 POS 사용 권한이 없습니다." }, { status: 403 });
    if (!member.employeePinHash) return NextResponse.json({ success: false, message: "공통 PIN이 설정되지 않았습니다. 관리자에게 문의해 주세요.", code: "EMPLOYEE_PIN_NOT_CONFIGURED" }, { status: 403 });
    if (!await verifyEmployeePin(pin, member.employeePinHash)) {
      if (!reserveAdminLoginAttempt(loginKey)) return rateLimited();
      return invalid();
    }

    const device = await getCurrentPosDevice();
    const approvedDevices = await db.select({ expiresAt: managedDevices.expiresAt }).from(managedDevices).where(and(
      eq(managedDevices.deviceType, "POS"), eq(managedDevices.status, "APPROVED"), eq(managedDevices.posEnabled, 1),
    ));
    const hasUsableApprovedDevice = approvedDevices.some(entry => entry.expiresAt && entry.expiresAt.getTime() > Date.now());
    let isRecoveryOwner = false;
    if (!hasUsableApprovedDevice) {
      const [owner] = await db.select({ staffId: adminSecurityOwners.staffId }).from(adminSecurityOwners)
        .where(eq(adminSecurityOwners.staffId, member.staffId)).limit(1);
      isRecoveryOwner = Boolean(owner);
    }
    if (!device && (hasUsableApprovedDevice || !isRecoveryOwner)) {
      return NextResponse.json({ success: false, code: "DEVICE_APPROVAL_REQUIRED",
        message: "이 POS 기기는 아직 승인되지 않았습니다. 기기등록 탭에서 승인 요청을 해 주세요." },
      { status: 403, headers: { "Cache-Control": "no-store" } });
    }

    const token = createSessionToken();
    await db.insert(staffSessions).values({ staffId: member.staffId, managedDeviceId: device?.deviceId ?? null,
      sessionTokenHash: hashSessionToken(token), sessionType: "POS", status: "ACTIVE" });
    clearAdminLoginAttempts(loginKey);
    clearAdminLoginAttempts(`pos-verify:${member.staffId}`);
    const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions);
    return response;
  } catch (error) {
    const detail = error as { code?: string; cause?: { code?: string } };
    console.error("POS staff login unavailable", { code: detail?.code ?? detail?.cause?.code });
    return NextResponse.json({ success: false, message: "로그인 서비스를 이용할 수 없습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
