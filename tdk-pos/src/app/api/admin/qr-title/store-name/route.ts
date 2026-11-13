import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminAccess } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";
import { storeInfoSettingKeys } from "@/lib/store-info";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const denied = await requireAdminAccess();
  if (denied) return denied;
  const staff = await getCurrentAdminStaff();
  if (!staff || !canManageMenu(staff.role)) return Response.json({ success: false, message: "ADM 권한이 필요합니다." }, { status: 403 });
  try {
    const body = await request.json() as { storeName?: unknown };
    if (typeof body.storeName !== "string") return Response.json({ success: false, message: "상호명을 입력해 주세요." }, { status: 400 });
    const storeName = body.storeName.trim();
    if (!storeName || [...storeName].length > 60 || /[\u0000-\u001f\u007f]/.test(storeName)) {
      return Response.json({ success: false, message: "상호명은 공백만 입력할 수 없으며 60자 이내로 입력해 주세요." }, { status: 400 });
    }
    await db.insert(systemSettings).values({ settingKey: storeInfoSettingKeys.storeName, settingValue: storeName, updatedByStaffId: staff.staffId })
      .onDuplicateKeyUpdate({ set: { settingValue: storeName, updatedByStaffId: staff.staffId, updatedAt: new Date() } });
    return Response.json({ success: true, storeName }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "상호명을 저장하지 못했습니다." }, { status: 500 });
  }
}
