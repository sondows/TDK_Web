import { requireAdminWrite } from "@/lib/admin-auth";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { canManageSettings } from "@/lib/permissions";
import { isKdsCompletionCountdownSeconds } from "@/lib/kds-model";
import { getKdsCompletionCountdownSeconds, KDS_COMPLETION_COUNTDOWN_SETTING_KEY } from "@/lib/kds-completion-countdown-setting";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  try {
    return Response.json({ success: true, seconds: await getKdsCompletionCountdownSeconds() }, { headers: noStore });
  } catch {
    return Response.json({ success: false, message: "KDS 완료 카운트다운 설정을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const denied = await requireAdminWrite();
  if (denied) return denied;
  const staff = await getCurrentAdminStaff();
  if (!staff || !canManageSettings(staff.role)) return Response.json({ success: false, message: "OWNER 권한이 필요합니다." }, { status: 403 });

  const body = await request.json().catch(() => null) as { seconds?: unknown } | null;
  if (!isKdsCompletionCountdownSeconds(body?.seconds)) {
    return Response.json({ success: false, message: "완료 카운트다운은 1~30초 정수로 설정해 주세요." }, { status: 400 });
  }

  try {
    const settingValue = String(body.seconds);
    await db.insert(systemSettings).values({ settingKey: KDS_COMPLETION_COUNTDOWN_SETTING_KEY, settingValue, updatedByStaffId: staff.staffId })
      .onDuplicateKeyUpdate({ set: { settingValue, updatedByStaffId: staff.staffId, updatedAt: new Date() } });
    return Response.json({ success: true, seconds: body.seconds }, { headers: noStore });
  } catch {
    return Response.json({ success: false, message: "KDS 완료 카운트다운 설정을 저장하지 못했습니다." }, { status: 500 });
  }
}
