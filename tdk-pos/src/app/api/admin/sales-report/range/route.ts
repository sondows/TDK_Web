import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { firstAvailableUnifiedSalesDate } from "@/lib/unified-sales-report";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "관리센터 접근 권한이 필요합니다." }, { status: 403 });
  try {
    return Response.json({ success: true, firstAvailableDate: await firstAvailableUnifiedSalesDate() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("admin sales report range failed", error);
    return Response.json({ success: false, message: "매출조회 기간을 불러오지 못했습니다." }, { status: 500 });
  }
}
