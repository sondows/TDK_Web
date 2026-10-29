import { requireAdminAccess, getCurrentAdminStaff } from "@/lib/admin-auth";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { canManageSettings } from "@/lib/permissions";
import { isKdsCompletedTimeShrinkStartMinutes } from "@/lib/kds-model";
import { getKdsCompletedTimeShrinkStartMinutes, KDS_COMPLETED_TIME_SHRINK_SETTING_KEY } from "@/lib/kds-completed-time-shrink-setting";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  try {
    return Response.json({ success: true, minutes: await getKdsCompletedTimeShrinkStartMinutes() }, { headers: noStore });
  } catch {
    return Response.json({ success: false, message: "완료시간 글씨 축소 설정을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const denied = await requireAdminAccess();
  if (denied) return denied;
  const staff = await getCurrentAdminStaff();
  if (!staff || !canManageSettings(staff.role)) return Response.json({ success: false, message: "OWNER 권한이 필요합니다." }, { status: 403 });

  const body = await request.json().catch(() => null) as { minutes?: unknown } | null;
  if (!isKdsCompletedTimeShrinkStartMinutes(body?.minutes)) {
    return Response.json({ success: false, message: "시작시간은 0~120분 사이의 정수로 설정해 주세요." }, { status: 400 });
  }

  try {
    const settingValue = String(body.minutes);
    await db.insert(systemSettings).values({ settingKey: KDS_COMPLETED_TIME_SHRINK_SETTING_KEY, settingValue, updatedByStaffId: staff.staffId })
      .onDuplicateKeyUpdate({ set: { settingValue, updatedByStaffId: staff.staffId, updatedAt: new Date() } });
    return Response.json({ success: true, minutes: body.minutes }, { headers: noStore });
  } catch {
    return Response.json({ success: false, message: "완료시간 글씨 축소 설정을 저장하지 못했습니다." }, { status: 500 });
  }
}
