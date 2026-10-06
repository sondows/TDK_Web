import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { canManageSettings } from "@/lib/permissions";
import { getManagementOwner } from "@/lib/management-auth";

export async function PUT(request: Request) {
  const staff = await getManagementOwner();
  if (!staff) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  if (!canManageSettings(staff.role)) return Response.json({ success: false, message: "OWNER만 POS 자동 초기화 설정을 변경할 수 있습니다." }, { status: 403 });

  try {
    const body = await request.json() as { seconds?: unknown };
    const seconds = typeof body.seconds === "number" ? body.seconds : Number(body.seconds);
    if (!Number.isSafeInteger(seconds) || seconds < 0) return Response.json({ success: false, message: "자동 초기화 시간은 0 이상의 정수 초여야 합니다." }, { status: 400 });
    await db.insert(systemSettings).values({ settingKey: "pos_idle_reset_seconds", settingValue: String(seconds), updatedByStaffId: staff.staffId }).onDuplicateKeyUpdate({ set: { settingValue: String(seconds), updatedByStaffId: staff.staffId, updatedAt: new Date() } });
    return Response.json({ success: true, seconds });
  } catch {
    return Response.json({ success: false, message: "설정 저장에 실패했습니다." }, { status: 500 });
  }
}
