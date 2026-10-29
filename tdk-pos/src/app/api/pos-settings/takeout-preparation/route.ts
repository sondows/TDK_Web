import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminAccessForAdminSession } from "@/lib/admin-auth";
import { getCurrentStaff } from "@/lib/auth";
import { getManagementOwner } from "@/lib/management-auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import {
  getTakeoutPreparationMinutes,
  isValidTakeoutPreparationMinutes,
  maxTakeoutPreparationMinutes,
  takeoutPreparationSettingKey,
} from "@/lib/takeout-preparation-setting";

export async function GET() {
  const [admin, staff, mode] = await Promise.all([
    getCurrentAdminStaff(), getCurrentStaff(), getPosLoginMode(),
  ]);
  if (!admin && !staff && mode !== "SHARED") {
    return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  }
  try {
    return Response.json({ success: true, minutes: await getTakeoutPreparationMinutes() });
  } catch {
    return Response.json({ success: false, message: "포장 준비시간을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const writeDenied = await requireAdminAccessForAdminSession(); if (writeDenied) return writeDenied;
  const staff = await getManagementOwner();
  if (!staff) {
    return Response.json({ success: false, message: "관리자 인증이 필요합니다." }, { status: 401 });
  }
  let body: { minutes?: unknown };
  try {
    body = await request.json() as { minutes?: unknown };
  } catch {
    return Response.json({ success: false, message: "올바른 요청 형식이 아닙니다." }, { status: 400 });
  }
  const minutes = body?.minutes;
  if (!isValidTakeoutPreparationMinutes(minutes)) {
    return Response.json({ success: false, message: `준비시간은 1~${maxTakeoutPreparationMinutes}분의 정수로 입력하세요.` }, { status: 400 });
  }
  try {
    await db.insert(systemSettings).values({
      settingKey: takeoutPreparationSettingKey,
      settingValue: String(minutes),
      updatedByStaffId: staff.staffId,
    }).onDuplicateKeyUpdate({ set: {
      settingValue: String(minutes),
      updatedByStaffId: staff.staffId,
      updatedAt: new Date(),
    } });
    return Response.json({ success: true, minutes });
  } catch {
    return Response.json({ success: false, message: "포장 준비시간을 저장하지 못했습니다." }, { status: 500 });
  }
}
