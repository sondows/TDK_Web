import { getCurrentKdsAccount } from "@/lib/kds-auth";
import { listKdsTasks, syncKdsOrders } from "@/lib/kds-server";
import { getKdsArrivalSoundSettings } from "@/lib/kds-arrival-sound-setting";
import { DEFAULT_KDS_ARRIVAL_SOUND_SETTINGS } from "@/lib/kds-arrival-sound";
import { getKdsCookingSettings } from "@/lib/kds-cooking-settings";

export async function GET() {
  if (!(await getCurrentKdsAccount())) {
    return Response.json({ success: false, message: "KDS 로그인이 필요합니다." }, { status: 401 });
  }
  try {
    await syncKdsOrders();
    const tasks = await listKdsTasks();
    let arrivalSound = DEFAULT_KDS_ARRIVAL_SOUND_SETTINGS;
    try { arrivalSound = await getKdsArrivalSoundSettings(); } catch (error) { console.error("KDS 도착음 설정 조회 오류:", error); }
    const cookingSettings = await getKdsCookingSettings();
    return Response.json({ success: true, tasks, arrivalSound, cookingSettings, serverNowMs: Date.now() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("KDS 목록 조회 오류:", error);
    return Response.json({ success: false, message: "주방 주문을 불러오지 못했습니다. KDS migration과 DB 연결을 확인해 주세요." }, { status: 500 });
  }
}
