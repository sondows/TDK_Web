import { and, asc, eq, isNotNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { staff } from "@/db/schema";

/** Publicly safe identity list used by the personal POS login screen. */
export async function GET() {
  try {
    const employees = await db
      .select({
        staffId: staff.staffId,
        staffCode: staff.staffCode,
        name: staff.name,
        role: staff.role,
      })
      .from(staff)
      .where(
        and(
          eq(staff.isActive, 1),
          ne(staff.staffCode, "000"),
          isNotNull(staff.pinHash)
        )
      )
      .orderBy(asc(staff.name));

    return Response.json({
      success: true,
      staff: employees.map(employee => ({ ...employee, hasPin: true })),
    });
  } catch (error) {
    console.error("Failed to load active login staff", error);
    return Response.json(
      { success: false, message: "직원 목록을 불러올 수 없습니다." },
      { status: 500 }
    );
  }
}

