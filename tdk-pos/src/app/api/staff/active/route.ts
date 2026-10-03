import { and, asc, eq, isNotNull, ne, or } from "drizzle-orm";

import { db } from "@/db";
import { staff } from "@/db/schema";
import { getConfiguredPosLoginMode } from "@/lib/pos-login-mode";

/** Publicly safe identity list used by the personal POS login screen. */
export async function GET() {
  try {
    const sharedMode = await getConfiguredPosLoginMode() === "SHARED";
    const employees = await db
      .select({
        staffId: staff.staffId,
        staffCode: staff.staffCode,
        name: staff.name,
        role: staff.role,
        pinHash: staff.pinHash,
      })
      .from(staff)
      .where(
        and(
          eq(staff.isActive, 1),
          sharedMode ? or(eq(staff.staffCode, "000"), isNotNull(staff.pinHash)) : and(ne(staff.staffCode, "000"), isNotNull(staff.pinHash))
        )
      )
      .orderBy(asc(staff.staffCode));

    return Response.json({
      success: true,
      staff: employees.map(employee => ({ staffId: employee.staffId, staffCode: employee.staffCode, name: employee.staffCode === "000" ? "매장 공용" : employee.name, role: employee.role, hasPin: Boolean(employee.pinHash) })),
    });
  } catch (error) {
    console.error("Failed to load active login staff", error);
    return Response.json(
      { success: false, message: "직원 목록을 불러올 수 없습니다." },
      { status: 500 }
    );
  }
}
