import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { listKdsTasks, syncKdsOrders } from "@/lib/kds-server";
import { activeKdsSessionIds, getKdsPartyTableOrder, getKdsTableOrder } from "@/lib/kds-table-order";

export async function GET() {
  if (!await getCurrentStaff() && await getPosLoginMode() !== "SHARED") {
    return Response.json({ success: false, message: "POS 로그인이 필요합니다." }, { status: 401 });
  }
  try {
    await syncKdsOrders();
    const tasks = await listKdsTasks();
    const activeSessionIds = activeKdsSessionIds(tasks);
    const tableOrder = await getKdsTableOrder(activeSessionIds);
    const partyOrder = await getKdsPartyTableOrder(activeSessionIds);
    return Response.json({ success: true, tasks, tableOrder, partyOrder, serverNowMs: Date.now() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("POS kitchen task query failed", error);
    return Response.json({ success: false, message: "주방 작업을 불러오지 못했습니다." }, { status: 500 });
  }
}
