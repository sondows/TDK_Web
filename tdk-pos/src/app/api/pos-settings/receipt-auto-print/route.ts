import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getManagementOwner } from "@/lib/management-auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { getReceiptAutoPrintAfterPayment, receiptAutoPrintSettingKey } from "@/lib/receipt-auto-print-setting";

export async function GET() {
  const [staff, mode] = await Promise.all([getCurrentStaff(), getPosLoginMode()]);
  if (!staff && mode !== "SHARED") return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  try {
    return Response.json({ success: true, enabled: await getReceiptAutoPrintAfterPayment() });
  } catch {
    return Response.json({ success: false, message: "영수증 인쇄 설정을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const staff = await getManagementOwner();
  if (!staff) return Response.json({ success: false, message: "관리자 인증이 필요합니다." }, { status: 401 });
  try {
    const body = await request.json() as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") return Response.json({ success: false, message: "ON/OFF 값을 확인해 주세요." }, { status: 400 });
    await db.insert(systemSettings).values({
      settingKey: receiptAutoPrintSettingKey,
      settingValue: body.enabled ? "1" : "0",
      updatedByStaffId: staff.staffId,
    }).onDuplicateKeyUpdate({ set: {
      settingValue: body.enabled ? "1" : "0",
      updatedByStaffId: staff.staffId,
      updatedAt: new Date(),
    } });
    return Response.json({ success: true, enabled: body.enabled });
  } catch {
    return Response.json({ success: false, message: "영수증 인쇄 설정을 저장하지 못했습니다." }, { status: 500 });
  }
}
