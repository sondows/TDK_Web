import { asc, ne } from "drizzle-orm";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { requireOwnerSecurityAccess } from "@/lib/admin-auth";

/** Compatibility read endpoint; all writes go through the shared-PIN security staff API. */
export async function GET() {
  const ownerDenied = await requireOwnerSecurityAccess(); if (ownerDenied) return ownerDenied;
  try {
    const rows = await db.select({ staffId: staff.staffId, staffCode: staff.staffCode, name: staff.name, role: staff.role, isActive: staff.isActive, hasPin: staff.employeePinHash, legacyPosPin: staff.pinHash })
      .from(staff).where(ne(staff.staffCode, "000")).orderBy(asc(staff.name), asc(staff.staffCode));
    return Response.json({ success: true, staff: rows.map(row => ({ staffId: row.staffId, staffCode: row.staffCode, name: row.name, role: row.role, isActive: row.isActive, hasPin: Boolean(row.hasPin || row.legacyPosPin), isShared: false })) });
  } catch { return Response.json({ success: false, message: "직원 목록을 불러올 수 없습니다." }, { status: 500 }); }
}

export async function POST() {
  const ownerDenied = await requireOwnerSecurityAccess(); if (ownerDenied) return ownerDenied;
  return Response.json({ success: false, message: "구형 직원 등록 API는 종료되었습니다. 보안 → 직원관리에서 공통 PIN으로 등록해 주세요." }, { status: 410 });
}
