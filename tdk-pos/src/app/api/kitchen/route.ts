import { getCurrentKdsStaff } from "@/lib/kds-auth";
import { listKdsTasks, syncKdsOrders } from "@/lib/kds-server";
import { getKdsArrivalSoundSettings } from "@/lib/kds-arrival-sound-setting";
import { DEFAULT_KDS_ARRIVAL_SOUND_SETTINGS } from "@/lib/kds-arrival-sound";
import { getKdsCookingSettings } from "@/lib/kds-cooking-settings";
import { getKdsCompletionCountdownSeconds } from "@/lib/kds-completion-countdown-setting";
import { getKdsCompletedTimeShrinkStartMinutes } from "@/lib/kds-completed-time-shrink-setting";
import { activeKdsSessionIds, getKdsPartyTableOrder, getKdsTableOrder } from "@/lib/kds-table-order";
import { pool } from "@/db";
import type { RowDataPacket } from "mysql2/promise";

export async function GET() {
  if (!(await getCurrentKdsStaff())) {
    return Response.json({ success: false, message: "KDS 로그인이 필요합니다." }, { status: 401 });
  }
  try {
    await syncKdsOrders();
    const tasks = await listKdsTasks();
    const activeSessionIds = activeKdsSessionIds(tasks);
    const tableOrder = await getKdsTableOrder(activeSessionIds);
    const partyOrder = await getKdsPartyTableOrder(activeSessionIds);
    let arrivalSound = DEFAULT_KDS_ARRIVAL_SOUND_SETTINGS;
    try { arrivalSound = await getKdsArrivalSoundSettings(); } catch (error) { console.error("KDS 도착음 설정 조회 오류:", error); }
    const cookingSettings = await getKdsCookingSettings();
    const completionCountdownSeconds = await getKdsCompletionCountdownSeconds();
    const completedTimeShrinkStartMinutes = await getKdsCompletedTimeShrinkStartMinutes();
    const [spicyAlerts] = await pool.query<Array<RowDataPacket & { id: number; sessionId: number; message: string; createdAtMs: number }>>(
      `SELECT audit_log_id AS id,entity_id AS sessionId,description AS message,
         ROUND(UNIX_TIMESTAMP(created_at)*1000) AS createdAtMs FROM audit_logs
       WHERE action_type='KDS_SPICY_CHANGE' AND entity_type='TABLE_SESSION'
         AND created_at>=NOW()-INTERVAL 10 SECOND ORDER BY audit_log_id DESC LIMIT 50`,
    );
    return Response.json({ success: true, tasks, tableOrder, partyOrder, spicyAlerts, arrivalSound, cookingSettings, completionCountdownSeconds, completedTimeShrinkStartMinutes, serverNowMs: Date.now() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("KDS 목록 조회 오류:", error);
    return Response.json({ success: false, message: "주방 주문을 불러오지 못했습니다. KDS migration과 DB 연결을 확인해 주세요." }, { status: 500 });
  }
}
