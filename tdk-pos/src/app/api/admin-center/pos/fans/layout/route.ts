import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { loadPosFanLayouts } from "@/lib/pos-fan-server";

export async function GET() {
  const staff = await getCurrentAdminStaff();
  if (!staff || staff.role !== "OWNER") {
    return Response.json({ success: false, message: "OWNER 권한이 필요합니다." }, { status: staff ? 403 : 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    return Response.json({ success: true, fans: await loadPosFanLayouts() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "선풍기 배치를 불러오지 못했습니다." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
