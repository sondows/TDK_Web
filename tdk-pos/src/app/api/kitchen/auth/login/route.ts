import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, managedDevices, staff, staffSessions } from "@/db/schema";
import { createSessionToken, hashSessionToken, verifyEmployeePin } from "@/lib/auth";
import { clearKdsLoginAttempts, isKdsLoginAttemptAllowed, recordKdsLoginFailure } from "@/lib/kds-login-limit";
import { KDS_SESSION_COOKIE_NAME, kdsSessionCookieOptions } from "@/lib/kds-auth";
import { getCurrentKdsDevice, kdsCookieSecureForRequest, reserveKdsIpAttempt, isSameOriginRequest } from "@/lib/kds-device";
import { getKdsNetworkContext } from "@/lib/kds-network-server";
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
  let authStage = "ip_attempt_limit";
  try {
    if (!await reserveKdsIpAttempt()) return failure(429, "Too many attempts from this network. Try again in 15 minutes.", "KDS_IP_RATE_LIMIT");
    authStage = "employee_lookup";
    const candidates = await db.select({
      staffId: staff.staffId, employeePinHash: staff.employeePinHash,
      isActive: staff.isActive, kdsEnabled: staff.kdsEnabled, kdsPinChangeRequired: staff.kdsPinChangeRequired,
      staffCode: staff.staffCode,
    }).from(staff).where(sql`LOWER(${staff.adminLoginId}) = ${loginId}`).limit(2);
    const candidate = candidates.length === 1 ? candidates[0] : null;
    if (!candidate || Number(candidate.isActive) !== 1 || candidate.staffCode === "000") {
      if (!await isKdsLoginAttemptAllowed(null, loginId)) return failure(429, "Too many attempts. Try again in 15 minutes.", "KDS_EMPLOYEE_RATE_LIMIT");
      const allowed = await recordKdsLoginFailure(null, loginId);
      return allowed ? failure(401, "Employee ID or KDS PIN is incorrect.") : failure(429, "Too many attempts. Try again in 15 minutes.", "KDS_EMPLOYEE_RATE_LIMIT");
    }
    authStage = "employee_attempt_limit";
    if (!await isKdsLoginAttemptAllowed(candidate.staffId, loginId)) return failure(429, "Too many attempts. Try again in 15 minutes.", "KDS_EMPLOYEE_RATE_LIMIT");
    authStage = "common_pin_verification";
    const pinMatches = candidate.employeePinHash ? await verifyEmployeePin(pin, candidate.employeePinHash) : false;
    if (!pinMatches) {
      const allowed = await recordKdsLoginFailure(candidate.staffId, loginId);
      await db.insert(auditLogs).values({ staffId: candidate.staffId, actionType: "KDS_LOGIN_FAILED", entityType: "KDS_AUTH", entityId: candidate.staffId, description: "invalid PIN" });
      return allowed ? failure() : failure(429, "Too many attempts. Try again in 15 minutes.", "KDS_EMPLOYEE_RATE_LIMIT");
    }
    authStage = "clear_login_attempts";
    await clearKdsLoginAttempts(candidate.staffId);
    if (Number(candidate.kdsEnabled) !== 1) return failure(403, "KDS access is not enabled for this employee. Contact an administrator.", "KDS_PERMISSION_DENIED");
    authStage = "device_and_network_policy";
    const network = await getKdsNetworkContext();
    const device = await getCurrentKdsDevice();
    const allowed = network.isInternal || Boolean(device);
    authStage = "login_audit";
    await db.insert(auditLogs).values({
      staffId: candidate.staffId, actionType: allowed ? "KDS_LOGIN_SUCCESS" : "KDS_LOGIN_FAILED",
      entityType: "KDS_AUTH", entityId: candidate.staffId,
      description: `staffId=${candidate.staffId}; network=${network.isInternal ? "internal" : "external"}; trustedDevice=${device ? "yes" : "no"}`,
    });
    if (!allowed) return failure(403, "This device is not approved or its registration has expired. Submit a request from Register device.", "DEVICE_APPROVAL_REQUIRED");
    const token = createSessionToken();
    authStage = "session_create";
    await db.insert(staffSessions).values({
      staffId: candidate.staffId, managedDeviceId: device?.deviceId ?? null,
      sessionTokenHash: hashSessionToken(token), sessionType: "KDS", status: "ACTIVE",
    });
    if (device) {
      authStage = "device_last_used_update";
      await db.update(managedDevices).set({ lastUsedAt: new Date() }).where(eq(managedDevices.deviceId, device.deviceId));
    }
    const response = NextResponse.json({ success: true, requiresPinChange: !candidate.employeePinHash && candidate.kdsPinChangeRequired === 1 }, { headers: { "Cache-Control": "no-store" } });
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
