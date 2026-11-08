import { getCurrentStaff } from "@/lib/auth";
import { commandPosFan, findPosFanLayout } from "@/lib/pos-fan-server";

export async function POST(request: Request, context: { params: Promise<{ fanId: string }> }) {
  if (!await getCurrentStaff()) return Response.json({ success: false, code: "POS_AUTH_REQUIRED", message: "POS 로그인 세션이 필요합니다." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { fanId: rawFanId } = await context.params;
  const fanId = Number(rawFanId);
  if (!Number.isInteger(fanId) || fanId < 1 || fanId > 6) return Response.json({ success: false, code: "INVALID_FAN", message: "선풍기 항목이 올바르지 않습니다." }, { status: 400 });
  try {
    const body = await request.json() as { state?: unknown };
    if (body.state !== "on" && body.state !== "off") return Response.json({ success: false, code: "INVALID_STATE", message: "요청 상태가 올바르지 않습니다." }, { status: 400 });
    const layout = await findPosFanLayout(fanId);
    if (!layout || !layout.isVisible) return Response.json({ success: false, code: "FAN_NOT_CONFIGURED", message: "선풍기 배치를 확인할 수 없습니다." }, { status: 404 });
    const result = await commandPosFan(layout, body.state);
    if (!result.success) {
      const status = result.code === "HA_NOT_CONFIGURED" ? 503 : result.code === "HA_STATE_NOT_CONFIRMED" ? 504 : 502;
      return Response.json({ success: false, code: result.code, httpStatus: result.httpStatus, state: result.state, message: "선풍기 명령을 확인하지 못했습니다." }, { status, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ success: true, state: result.state }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, code: "POS_FAN_REQUEST_FAILED", message: "선풍기 요청을 처리하지 못했습니다." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
