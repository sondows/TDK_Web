import { getCurrentStaff } from "@/lib/auth";
import { loadPosFanLayouts, getPosFanStates } from "@/lib/pos-fan-server";

export async function GET() {
  if (!await getCurrentStaff()) return Response.json({ success: false, code: "POS_AUTH_REQUIRED", message: "POS 로그인 세션이 필요합니다." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const result = await getPosFanStates(await loadPosFanLayouts());
    return Response.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, code: "POS_FAN_QUERY_FAILED", message: "선풍기 상태를 조회하지 못했습니다." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
