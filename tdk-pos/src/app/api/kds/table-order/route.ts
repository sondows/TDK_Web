import { getCurrentStaff } from "@/lib/auth";
import { getCurrentKdsStaff } from "@/lib/kds-auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { persistKdsPartyTableOrder, persistKdsTableOrder } from "@/lib/kds-table-order";

export async function POST(request: Request) {
  if (!await getCurrentStaff() && !await getCurrentKdsStaff() && await getPosLoginMode() !== "SHARED") {
    return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  }
  const body = await request.json().catch(() => null) as { sessionIds?: unknown; partyGroupId?: unknown } | null;
  const sessionIds = body?.sessionIds;
  if (!Array.isArray(sessionIds) || sessionIds.length > 300 ||
    sessionIds.some(id => !Number.isSafeInteger(id) || Number(id) <= 0)) {
    return Response.json({ success: false, message: "테이블 순서 정보가 올바르지 않습니다." }, { status: 400 });
  }
  try {
    if (body?.partyGroupId !== undefined) {
      if (!Number.isSafeInteger(body.partyGroupId) || Number(body.partyGroupId) <= 0) {
        return Response.json({ success: false, message: "일행 내부 순서 정보가 올바르지 않습니다." }, { status: 400 });
      }
      const partyOrder = await persistKdsPartyTableOrder(Number(body.partyGroupId), sessionIds as number[]);
      return Response.json({ success: true, partyOrder }, { headers: { "Cache-Control": "no-store" } });
    }
    const tableOrder = await persistKdsTableOrder(sessionIds as number[]);
    return Response.json({ success: true, tableOrder }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "테이블 조리 순서를 저장하지 못했습니다.";
    console.error("KDS table order save failed", error);
    const status = message.includes("목록이 변경") ? 409 : 500;
    return Response.json({ success: false, message }, { status });
  }
}
