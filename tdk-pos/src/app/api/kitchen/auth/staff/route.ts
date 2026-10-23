import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { staff } from "@/db/schema";

/** Active, non-shared employees with a POS PIN are listed for KDS sign-in. */
export async function GET() {
  try {
    const employees = await db.select({
      staffId: staff.staffId,
      staffCode: staff.staffCode,
      name: staff.name,
    }).from(staff).where(and(
      eq(staff.isActive, 1),
      ne(staff.staffCode, "000"),
      isNotNull(staff.pinHash),
    )).orderBy(asc(staff.staffCode));
    return Response.json({ success: true, staff: employees }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("KDS staff list failed", error);
    return Response.json({ success: false, message: "직원 목록을 불러올 수 없습니다." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
