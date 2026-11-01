import { and, asc, eq, isNotNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { adminSecurityOwners, staff } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { canViewSales } from "@/lib/permissions";

/** POS sales summary PIN choices; the summary POST enforces the same access rule. */
export async function GET() {
  try {
    if (!await getCurrentStaff()) {
      return Response.json({ success: false, message: "POS 로그인이 필요합니다." },
        { status: 401, headers: { "Cache-Control": "no-store" } });
    }

    const candidates = await db.select({
      staffId: staff.staffId,
      loginId: staff.adminLoginId,
      role: staff.role,
      securityOwnerId: adminSecurityOwners.staffId,
    }).from(staff)
      .leftJoin(adminSecurityOwners, eq(adminSecurityOwners.staffId, staff.staffId))
      .where(and(
        eq(staff.isActive, 1), eq(staff.posEnabled, 1), ne(staff.staffCode, "000"),
        isNotNull(staff.adminLoginId), ne(staff.adminLoginId, ""),
        isNotNull(staff.employeePinHash), ne(staff.employeePinHash, ""),
      ))
      .orderBy(asc(staff.adminLoginId));

    const managers = candidates
      .filter(candidate => canViewSales(candidate.role) || candidate.securityOwnerId === candidate.staffId)
      .map(candidate => ({ loginId: candidate.loginId, hasPin: true }));
    return Response.json({ success: true, staff: managers }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const detail = error as { code?: string; cause?: { code?: string } };
    console.error("POS sales summary manager list failed", { code: detail?.code ?? detail?.cause?.code });
    return Response.json({ success: false, message: "관리자 목록을 불러오지 못했습니다." },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
