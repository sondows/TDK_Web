import { asc, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminSecurityOwners, auditLogs, staff } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminAccess, requireOwnerSecurityAccess } from "@/lib/admin-auth";
import { hasHosStaffPermissionColumn, isDuplicateAdminLoginId, newInternalStaffCode, parseStaffDraft, staffColumns, staffColumnsWithoutHos, toStaffSummary } from "@/lib/staff-management-server";
import { isSameOriginRequest } from "@/lib/kds-device";
import { hashProgramPassword } from "@/lib/auth";
import { newTemporaryProgramPassword } from "@/lib/program-password-lifecycle";

export async function GET() {
  const ownerDenied = await requireOwnerSecurityAccess(); if (ownerDenied) return ownerDenied;
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "관리센터 로그인이 필요합니다." }, { status: 401 });
  try {
    const hosPermissionAvailable = await hasHosStaffPermissionColumn();
    const rows = await db.select(hosPermissionAvailable ? staffColumns : staffColumnsWithoutHos)
      .from(staff).where(ne(staff.staffCode, "000")).orderBy(asc(staff.name), asc(staff.staffCode));
    const owners = await db.select({ staffId: adminSecurityOwners.staffId }).from(adminSecurityOwners);
    const ownerIds = new Set(owners.map(owner => owner.staffId));
    return Response.json({ success: true, hosPermissionAvailable, staff: rows.map(row => ({
      ...toStaffSummary(row), isDesignatedOwner: ownerIds.has(row.staffId),
    })) });
  } catch (error) {
    console.error("Admin staff list failed", error);
    return Response.json({ success: false, message: "직원 목록을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ success: false }, { status: 403 });
  const ownerDenied = await requireOwnerSecurityAccess(); if (ownerDenied) return ownerDenied;
  const writeDenied = await requireAdminAccess(); if (writeDenied) return writeDenied;
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "관리센터 로그인이 필요합니다." }, { status: 401 });
  let parsed: ReturnType<typeof parseStaffDraft>;
  try { parsed = parseStaffDraft(await request.json()); }
  catch { return Response.json({ success: false, message: "요청 형식을 확인해 주세요." }, { status: 400 }); }
  if (!parsed) return Response.json({ success: false, message: "요청 형식을 확인해 주세요." }, { status: 400 });
  if (!parsed.valid) return Response.json({ success: false, errors: parsed.errors, message: "입력 내용을 확인해 주세요." }, { status: 400 });
  const { draft } = parsed;
  if (draft.role === "OWNER") return Response.json({ success: false, message: "OWNER 지정은 일반 직원관리에서 변경할 수 없습니다." }, { status: 403 });
  try {
    const hosPermissionAvailable = await hasHosStaffPermissionColumn();
    if (draft.hosEnabled && !hosPermissionAvailable) return Response.json({ success: false, code: "STAFF_HOS_SCHEMA_REQUIRED", message: "HOS 직원 권한 컬럼이 DB에 없어 HOS 권한을 저장할 수 없습니다." }, { status: 503 });
    const actor = await getCurrentAdminStaff();
    if (!actor) return Response.json({ success: false, message: "관리센터 로그인이 필요합니다." }, { status: 401 });
    const temporaryPassword = newTemporaryProgramPassword();
    const passwordHash = await hashProgramPassword(temporaryPassword);
    const staffId = await db.transaction(async tx => {
      const [duplicate] = await tx.select({ staffId: staff.staffId }).from(staff)
        .where(sql`LOWER(${staff.adminLoginId}) = ${draft.loginId}`).limit(1);
      if (duplicate) throw Object.assign(new Error("Duplicate employee ID"), { code: "EMPLOYEE_LOGIN_ID_DUPLICATE" });
      const staffCode = newInternalStaffCode();
      // Drizzle includes omitted mapped columns as DEFAULT in INSERT. Older DBs
      // have no hos_enabled column, so use an explicit column list there.
      if (hosPermissionAvailable) {
        await tx.insert(staff).values({
          staffCode, name: draft.name, role: draft.role, adminLoginId: draft.loginId,
          securityPasswordHash: passwordHash, securityPasswordChangeRequired: 1,
          isActive: draft.isActive ? 1 : 0, posEnabled: draft.posEnabled ? 1 : 0,
          hosEnabled: draft.hosEnabled ? 1 : 0, employeePinHash: null,
          kdsEnabled: draft.kdsEnabled ? 1 : 0, kdsPinChangeRequired: 0,
          adminEnabled: draft.adminEnabled ? 1 : 0,
        });
      } else {
        await tx.execute(sql`INSERT INTO staff
          (staff_code, name, role, admin_login_id, security_password_hash,
           security_password_change_required, is_active, pos_enabled,
           employee_pin_hash, kds_enabled, kds_pin_change_required, admin_enabled)
          VALUES (${staffCode}, ${draft.name}, ${draft.role}, ${draft.loginId},
                  ${passwordHash}, 1, ${draft.isActive ? 1 : 0},
                  ${draft.posEnabled ? 1 : 0}, NULL, ${draft.kdsEnabled ? 1 : 0},
                  0, ${draft.adminEnabled ? 1 : 0})`);
      }
      const [inserted] = await tx.select({ staffId: staff.staffId }).from(staff)
        .where(sql`${staff.staffCode} = ${staffCode}`).limit(1);
      if (!inserted) throw new Error("Employee insert was not visible");
      const id = inserted.staffId;
      await tx.insert(auditLogs).values({ staffId: actor.staffId, actionType: "STAFF_CREATED", entityType: "STAFF", entityId: id, description: "Employee account created" });
      return id;
    });
    return Response.json({ success: true, staffId, temporaryPassword }, {
      status: 201, headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "EMPLOYEE_LOGIN_ID_DUPLICATE" || isDuplicateAdminLoginId(error))
      return Response.json({ success: false, errors: { loginId: "이미 사용 중인 ID입니다." }, message: "이미 사용 중인 ID입니다." }, { status: 409 });
    const detail = error as { code?: string; cause?: { code?: string } };
    console.error("Admin staff create failed", { code: detail.code ?? detail.cause?.code });
    return Response.json({ success: false, message: "직원을 등록하지 못했습니다." }, { status: 500 });
  }
}
