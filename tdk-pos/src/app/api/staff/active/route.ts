import { and, asc, eq, isNotNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { staff } from "@/db/schema";

/** Publicly safe identity list used by the personal POS login screen. */
export async function GET() {
  try {
    const employees = await db
      .select({
        loginId: staff.adminLoginId,
        role: staff.role,
        posEnabled: staff.posEnabled,
        employeePinHash: staff.employeePinHash,
      })
      .from(staff)
      .where(
        and(
          eq(staff.isActive, 1),
          isNotNull(staff.employeePinHash), ne(staff.employeePinHash, ""), isNotNull(staff.adminLoginId), ne(staff.adminLoginId, ""),
          ne(staff.staffCode, "000"), eq(staff.posEnabled, 1)
        )
      )
      .orderBy(asc(staff.adminLoginId));

    return Response.json({
      success: true,
        staff: employees.map(employee => ({ loginId: employee.loginId, hasPin: Boolean(employee.employeePinHash), pinLength: 6 as const })),
    });
  } catch (error) {
    console.error("Failed to load active login staff", error);
    return Response.json(
      { success: false, message: "직원 목록을 불러올 수 없습니다." },
      { status: 500 }
    );
  }
}
