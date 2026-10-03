import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getConfiguredPosLoginMode } from "@/lib/pos-login-mode";
import { getPrivilegedStaff } from "@/lib/permissions";

export async function GET() {
  return Response.json({ mode: await getConfiguredPosLoginMode() });
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      mode?: unknown;
    };
    if (body.mode !== "PERSONAL" && body.mode !== "SHARED") {
      return Response.json({ success: false, message: "로그인 방식을 확인하세요." }, { status: 400 });
    }

    const approver = await getPrivilegedStaff();
    if (!approver) return Response.json({ success: false, message: "관리자 인증이 필요합니다." }, { status: 401 });
    if (approver.role !== "OWNER") return Response.json({ success: false, message: "OWNER만 로그인 방식을 변경할 수 있습니다." }, { status: 403 });

    await db.insert(systemSettings).values({
      settingKey: "pos_login_mode",
      settingValue: body.mode,
      updatedByStaffId: approver.staffId,
    }).onDuplicateKeyUpdate({
      set: { settingValue: body.mode, updatedByStaffId: approver.staffId, updatedAt: new Date() },
    });
    return Response.json({ success: true, mode: body.mode });
  } catch {
    return Response.json({ success: false, message: "로그인 방식 저장에 실패했습니다." }, { status: 500 });
  }
}
