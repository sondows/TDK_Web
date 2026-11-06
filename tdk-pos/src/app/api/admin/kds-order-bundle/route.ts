import { requireAdminAccess, getCurrentAdminStaff } from "@/lib/admin-auth";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { canManageSettings } from "@/lib/permissions";
import { isKdsOrderBundleSettings } from "@/lib/kds-model";
import { getKdsOrderBundleSettings, KDS_ORDER_BUNDLE_SETTING_KEYS } from "@/lib/kds-order-bundle-setting";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  try {
    return Response.json({ success: true, settings: await getKdsOrderBundleSettings() }, { headers: noStore });
  } catch {
    return Response.json({ success: false, message: "KDS 주문 묶음 설정을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const denied = await requireAdminAccess();
  if (denied) return denied;
  const staff = await getCurrentAdminStaff();
  if (!staff || !canManageSettings(staff.role)) return Response.json({ success: false, message: "OWNER 권한이 필요합니다." }, { status: 403 });

  const body = await request.json().catch(() => null) as { enabled?: unknown; minutes?: unknown } | null;
  const settings = { enabled: body?.enabled, minutes: body?.minutes };
  if (!isKdsOrderBundleSettings(settings)) {
    return Response.json({ success: false, message: "사용 여부와 묶음 시간(1~60분)을 확인해 주세요." }, { status: 400 });
  }

  try {
    await db.transaction(async tx => {
      for (const [settingKey, settingValue] of [
        [KDS_ORDER_BUNDLE_SETTING_KEYS.enabled, settings.enabled ? "1" : "0"],
        [KDS_ORDER_BUNDLE_SETTING_KEYS.minutes, String(settings.minutes)],
      ] as const) {
        await tx.insert(systemSettings).values({ settingKey, settingValue, updatedByStaffId: staff.staffId })
          .onDuplicateKeyUpdate({ set: { settingValue, updatedByStaffId: staff.staffId, updatedAt: new Date() } });
      }
    });
    return Response.json({ success: true, settings }, { headers: noStore });
  } catch {
    return Response.json({ success: false, message: "KDS 주문 묶음 설정을 저장하지 못했습니다." }, { status: 500 });
  }
}
