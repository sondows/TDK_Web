import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminAccess } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";
import { isQrTitleScreenId, normalizeQrTitleScreenSettings, qrTitleScreenSettingKey, type QrTitleScreenSettingField } from "@/lib/qr-title-model";
import { getQrTitleScreenSettings } from "@/lib/qr-title-settings";

export const dynamic = "force-dynamic";

async function authorize() {
  const denied = await requireAdminAccess();
  if (denied) return { error: denied };
  const staff = await getCurrentAdminStaff();
  if (!staff || !canManageMenu(staff.role)) return { error: Response.json({ success: false, message: "QR 타이틀 설정 권한이 없습니다." }, { status: 403 }) };
  return { staff };
}

export async function GET(_request: Request, context: { params: Promise<{ screenId: string }> }) {
  const auth = await authorize();
  if (auth.error) return auth.error;
  const { screenId } = await context.params;
  if (!isQrTitleScreenId(screenId)) return Response.json({ success: false, message: "QR 화면이 올바르지 않습니다." }, { status: 404 });
  try {
    return Response.json({ success: true, settings: await getQrTitleScreenSettings(screenId) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "QR 화면 타이틀 설정을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ screenId: string }> }) {
  const auth = await authorize();
  if (auth.error) return auth.error;
  const { screenId } = await context.params;
  if (!isQrTitleScreenId(screenId)) return Response.json({ success: false, message: "QR 화면이 올바르지 않습니다." }, { status: 404 });
  try {
    const body = await request.json() as { settings?: unknown };
    const settings = normalizeQrTitleScreenSettings(body.settings);
    if (!settings) return Response.json({ success: false, message: "타이틀 문구와 표시 옵션을 확인해 주세요. 직접 입력 문구는 비워 둘 수 없습니다." }, { status: 400 });
    const entries: Array<[QrTitleScreenSettingField, string]> = Object.entries(settings) as Array<[QrTitleScreenSettingField, string]>;
    await db.transaction(async tx => {
      for (const [field, settingValue] of entries) {
        await tx.insert(systemSettings).values({ settingKey: qrTitleScreenSettingKey(screenId, field), settingValue, updatedByStaffId: auth.staff.staffId })
          .onDuplicateKeyUpdate({ set: { settingValue, updatedByStaffId: auth.staff.staffId, updatedAt: new Date() } });
      }
    });
    return Response.json({ success: true, settings }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "QR 화면 타이틀 설정을 저장하지 못했습니다." }, { status: 500 });
  }
}
