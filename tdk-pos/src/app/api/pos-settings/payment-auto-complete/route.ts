import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getManagementOwner } from "@/lib/management-auth";
import { requireAdminAccessForAdminSession } from "@/lib/admin-auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { getPaymentAutoCompleteSeconds, paymentAutoCompleteSettingKey } from "@/lib/payment-auto-complete-setting";

export async function GET() {
  const [staff, mode] = await Promise.all([getCurrentStaff(), getPosLoginMode()]);
  if (!staff && mode !== "SHARED") return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  try {
    return Response.json({ success: true, seconds: await getPaymentAutoCompleteSeconds() });
  } catch {
    return Response.json({ success: false, message: "결제창 자동 완료 설정을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const writeDenied = await requireAdminAccessForAdminSession(); if (writeDenied) return writeDenied;
  const staff = await getManagementOwner();
  if (!staff) return Response.json({ success: false, message: "관리자 인증이 필요합니다." }, { status: 401 });
  try {
    const body = await request.json() as { seconds?: unknown };
    const seconds = body.seconds;
    if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds < 0) {
      return Response.json({ success: false, message: "자동 완료 시간은 0 이상의 정수 초여야 합니다." }, { status: 400 });
    }
    await db.insert(systemSettings).values({
      settingKey: paymentAutoCompleteSettingKey,
      settingValue: String(seconds),
      updatedByStaffId: staff.staffId,
    }).onDuplicateKeyUpdate({ set: {
      settingValue: String(seconds),
      updatedByStaffId: staff.staffId,
      updatedAt: new Date(),
    } });
    return Response.json({ success: true, seconds });
  } catch {
    return Response.json({ success: false, message: "결제창 자동 완료 설정을 저장하지 못했습니다." }, { status: 500 });
  }
}
