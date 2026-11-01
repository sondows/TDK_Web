import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { adminSecurityOwners, adminSecuritySettings, auditLogs,
  securityBootstrapState, staff } from "@/db/schema";
import { hashProgramPassword, isValidProgramPassword } from "@/lib/auth";
import { reserveAdminStatusAttempt } from "@/lib/admin-auth-limit";
import { getKdsRateLimitIp } from "@/lib/kds-network-server";
import { isNasOwnerSetupRequest, isNasOwnerSetupWrite } from "@/lib/nas-owner-setup";
import { isFirstOwnerSetupAvailable } from "@/lib/initial-admin-setup";
import { newInternalStaffCode } from "@/lib/staff-management-server";
import { hasHosStaffPermissionColumn } from "@/lib/staff-management-server";

const noStore = { "Cache-Control": "no-store" };

/** The one-way DB latch prevents reopening, even while NAS setup mode stays enabled. */
export async function GET(request: Request) {
  if (!isNasOwnerSetupRequest(request))
    return NextResponse.json({ available: false }, { headers: noStore });
  try {
    const [latch] = await db.select({ completedAt: securityBootstrapState.completedAt })
      .from(securityBootstrapState).where(eq(securityBootstrapState.stateId, 1)).limit(1);
    const [existing] = await db.select({ staffId: staff.staffId }).from(staff)
      .where(ne(staff.staffCode, "000")).limit(1);
    const [owner] = await db.select({ staffId: adminSecurityOwners.staffId }).from(adminSecurityOwners).limit(1);
    return NextResponse.json({ available: isFirstOwnerSetupAvailable({ latchExists: Boolean(latch),
      setupCompleted: Boolean(latch?.completedAt), staffExists: Boolean(existing), ownerExists: Boolean(owner) }) },
    { headers: noStore });
  } catch (error) {
    console.error("Initial owner status unavailable", { code: (error as { code?: string }).code });
    return NextResponse.json({ available: false }, { headers: noStore });
  }
}

/** Explicitly attested NAS/Windows-test setup; account creation still requires the one-way DB latch. */
export async function POST(request: Request) {
  if (!isNasOwnerSetupWrite(request))
    return NextResponse.json({ success: false }, { status: 403, headers: noStore });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const loginId = typeof body?.loginId === "string" ? body.loginId.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(loginId) || !isValidProgramPassword(password) ||
    password !== body?.confirmPassword)
    return NextResponse.json({ success: false, message: "입력 내용을 확인해 주세요." }, { status: 400, headers: noStore });
  const ip = await getKdsRateLimitIp();
  try {
    const requestAllowed = await reserveAdminStatusAttempt("initial-owner-setup", ip);
    if (requestAllowed === false) return NextResponse.json({ success: false,
      message: "최초 관리자 설정 요청이 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: noStore });
    const passwordHash = await hashProgramPassword(password);
    const hosPermissionAvailable = await hasHosStaffPermissionColumn();
    const created = await db.transaction(async tx => {
      const [latch] = await tx.select({ completedAt: securityBootstrapState.completedAt })
        .from(securityBootstrapState).where(eq(securityBootstrapState.stateId, 1)).limit(1).for("update");
      const [existing] = await tx.select({ staffId: staff.staffId }).from(staff)
        .where(ne(staff.staffCode, "000")).limit(1);
      const [owner] = await tx.select({ staffId: adminSecurityOwners.staffId }).from(adminSecurityOwners).limit(1);
      if (!isFirstOwnerSetupAvailable({ latchExists: Boolean(latch), setupCompleted: Boolean(latch?.completedAt),
        staffExists: Boolean(existing), ownerExists: Boolean(owner) })) return null;
      const staffCode = newInternalStaffCode();
      if (hosPermissionAvailable) {
        await tx.insert(staff).values({ staffCode,
          name: "최고관리자", adminLoginId: loginId, securityPasswordHash: passwordHash,
          role: "OWNER", isActive: 1, posEnabled: 1, adminEnabled: 1, kdsEnabled: 1,
          hosEnabled: 1, kdsPinChangeRequired: 0 });
      } else {
        // Drizzle includes omitted mapped columns as DEFAULT in INSERT.
        await tx.execute(sql`INSERT INTO staff
          (staff_code, name, admin_login_id, security_password_hash, role,
           is_active, pos_enabled, admin_enabled, kds_enabled, kds_pin_change_required)
          VALUES (${staffCode}, ${"최고관리자"}, ${loginId}, ${passwordHash},
                  'OWNER', 1, 1, 1, 1, 0)`);
      }
      const [inserted] = await tx.select({ staffId: staff.staffId }).from(staff)
        .where(eq(staff.staffCode, staffCode)).limit(1);
      if (!inserted) throw new Error("Initial owner insert was not visible");
      const staffId = inserted.staffId;
      await tx.insert(adminSecurityOwners).values({ staffId, passwordHash: null,
        credentialState: "SETUP_PENDING" });
      const [settings] = await tx.select({ id: adminSecuritySettings.settingsId })
        .from(adminSecuritySettings).where(eq(adminSecuritySettings.settingsId, 1)).limit(1);
      if (!settings) await tx.insert(adminSecuritySettings).values({ settingsId: 1, ownerStaffId: staffId });
      const now = new Date();
      await tx.update(securityBootstrapState).set({ completedAt: now })
        .where(and(eq(securityBootstrapState.stateId, 1), isNull(securityBootstrapState.completedAt)));
      await tx.insert(auditLogs).values({ staffId, actionType: "INITIAL_OWNER_CREATED",
        entityType: "STAFF", entityId: staffId });
      return true;
    });
    if (!created) return NextResponse.json({ success: false, message: "초기 등록이 이미 완료됐습니다." },
      { status: 409, headers: noStore });
    return NextResponse.json({ success: true }, { headers: noStore });
  } catch (error) {
    const detail = error as { code?: string; cause?: { code?: string } };
    console.error("Initial owner registration failed", { code: detail.code ?? detail.cause?.code });
    return NextResponse.json({ success: false, message: "최고관리자 초기 등록을 완료하지 못했습니다." },
      { status: 503, headers: noStore });
  }
}
