import { requireAdminWrite } from "@/lib/admin-auth";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { canManageSettings } from "@/lib/permissions";
import { getKdsCookingSettings, KDS_COOKING_SETTING_KEYS } from "@/lib/kds-cooking-settings";
import { isKdsCookingSettings, type KdsCookingSettings } from "@/lib/kds-model";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  try {
    return Response.json({ success: true, settings: await getKdsCookingSettings() }, { headers: noStore });
  } catch {
    return Response.json({ success: false, message: "KDS 조리 설정을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const denied = await requireAdminWrite();
  if (denied) return denied;
  const staff = await getCurrentAdminStaff();
  if (!staff || !canManageSettings(staff.role)) return Response.json({ success: false, message: "OWNER 권한이 필요합니다." }, { status: 403 });
  const body = await request.json().catch(() => null) as unknown;
  if (!isKdsCookingSettings(body)) return Response.json({ success: false, message: "시간은 서로 다른 1~60분 값으로 입력하고 기본값을 선택 시간 중 하나로 지정해 주세요." }, { status: 400 });
  const settings = body as KdsCookingSettings;
  const entries = [
    [KDS_COOKING_SETTING_KEYS.first, settings.boilTimeOptions[0]],
    [KDS_COOKING_SETTING_KEYS.second, settings.boilTimeOptions[1]],
    [KDS_COOKING_SETTING_KEYS.third, settings.boilTimeOptions[2]],
    [KDS_COOKING_SETTING_KEYS.default, settings.defaultBoilTimeMinutes],
  ] as const;
  try {
    await db.transaction(async tx => {
      for (const [settingKey, value] of entries) {
        const settingValue = String(value);
        await tx.insert(systemSettings).values({ settingKey, settingValue, updatedByStaffId: staff.staffId })
          .onDuplicateKeyUpdate({ set: { settingValue, updatedByStaffId: staff.staffId, updatedAt: new Date() } });
      }
    });
    return Response.json({ success: true, settings }, { headers: noStore });
  } catch {
    return Response.json({ success: false, message: "KDS 조리 설정을 저장하지 못했습니다." }, { status: 500 });
  }
}
