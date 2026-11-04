import { getCurrentHosStaff } from "@/lib/hos-auth";
import { loadPosMenuCatalog } from "@/lib/pos-menu-catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!await getCurrentHosStaff()) return Response.json({ success: false }, { status: 401,
    headers: { "Cache-Control": "no-store" } });
  try {
    return Response.json({ success: true, ...await loadPosMenuCatalog() },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("HOS menu catalog unavailable", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "메뉴 정보를 불러오지 못했습니다." }, { status: 503,
      headers: { "Cache-Control": "no-store" } });
  }
}
