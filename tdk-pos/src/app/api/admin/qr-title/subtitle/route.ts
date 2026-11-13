import { eq } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminAccess } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";
import { normalizeQrTitleSubtitle, QR_TITLE_SUBTITLE_SETTING_KEY } from "@/lib/qr-title-model";

export const dynamic = "force-dynamic";

async function authorize() {
  const denied = await requireAdminAccess();
  if (denied) return { error: denied };
  const staff = await getCurrentAdminStaff();
  if (!staff || !canManageMenu(staff.role)) return { error: Response.json({ success: false, message: "ADM 권한이 필요합니다." }, { status: 403 }) };
  return { staff };
}

export async function PUT(request: Request) {
  const auth = await authorize();
  if (auth.error) return auth.error;
  try {
    const body = await request.json() as { subtitle?: unknown };
    const subtitle = normalizeQrTitleSubtitle(body.subtitle);
    if (subtitle === null) return Response.json({ success: false, message: "보조 문구는 40자 이내로 입력해 주세요." }, { status: 400 });

    await db.transaction(async tx => {
      if (!subtitle) {
        await tx.delete(systemSettings).where(eq(systemSettings.settingKey, QR_TITLE_SUBTITLE_SETTING_KEY));
        return;
      }
      await tx.insert(systemSettings).values({ settingKey: QR_TITLE_SUBTITLE_SETTING_KEY, settingValue: subtitle, updatedByStaffId: auth.staff.staffId })
        .onDuplicateKeyUpdate({ set: { settingValue: subtitle, updatedByStaffId: auth.staff.staffId, updatedAt: new Date() } });
    });

    return Response.json({ success: true, subtitle }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "보조 문구를 저장하지 못했습니다." }, { status: 500 });
  }
}
