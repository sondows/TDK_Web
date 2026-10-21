import { requireAdminWrite } from "@/lib/admin-auth";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { canManageSettings } from "@/lib/permissions";
import { getKdsArrivalSoundSettings } from "@/lib/kds-arrival-sound-setting";
import { KDS_ARRIVAL_SOUND_SETTING_KEYS, isKdsArrivalSoundKey } from "@/lib/kds-arrival-sound";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "관리센터 로그인이 필요합니다." }, { status: 401 });
  try {
    return Response.json({ success: true, settings: await getKdsArrivalSoundSettings() }, { headers: noStore });
  } catch {
    return Response.json({ success: false, message: "KDS 도착음 설정을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const denied = await requireAdminWrite();
  if (denied) return denied;
  const staff = await getCurrentAdminStaff();
  if (!staff || !canManageSettings(staff.role)) return Response.json({ success: false, message: "OWNER 권한이 필요합니다." }, { status: 403 });
  const body = await request.json().catch(() => null) as { enabled?: unknown; soundKey?: unknown; repeat?: unknown } | null;
  if (typeof body?.enabled !== "boolean" || !isKdsArrivalSoundKey(body.soundKey) || ![1, 2, 3].includes(Number(body.repeat)) || !Number.isInteger(Number(body.repeat))) {
    return Response.json({ success: false, message: "도착음 설정을 확인해 주세요." }, { status: 400 });
  }
  const values = [
    [KDS_ARRIVAL_SOUND_SETTING_KEYS.enabled, body.enabled ? "1" : "0"],
    [KDS_ARRIVAL_SOUND_SETTING_KEYS.soundKey, body.soundKey],
    [KDS_ARRIVAL_SOUND_SETTING_KEYS.repeat, String(body.repeat)],
  ] as const;
  try {
    await db.transaction(async tx => {
      for (const [settingKey, settingValue] of values) {
        await tx.insert(systemSettings).values({ settingKey, settingValue, updatedByStaffId: staff.staffId })
          .onDuplicateKeyUpdate({ set: { settingValue, updatedByStaffId: staff.staffId, updatedAt: new Date() } });
      }
    });
    return Response.json({ success: true, settings: { enabled: body.enabled, soundKey: body.soundKey, repeat: Number(body.repeat) } }, { headers: noStore });
  } catch {
    return Response.json({ success: false, message: "KDS 도착음 설정을 저장하지 못했습니다." }, { status: 500 });
  }
}
