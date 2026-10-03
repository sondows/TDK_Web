import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { hashAdminPin, isValidAdminPin } from "@/lib/auth";
import { isValidAdminLoginId, normalizeAdminLoginId } from "@/lib/admin-auth";
import { getPrivilegedStaff } from "@/lib/permissions";

export async function PUT(request: Request, { params }: { params: Promise<{ staffId: string }> }) {
  const actor = await getPrivilegedStaff();
  if (!actor || actor.role !== "OWNER" || actor.staffCode === "000") return Response.json({ success: false, message: "OWNER 권한이 필요합니다." }, { status: 403 });
  const staffId = Number((await params).staffId);
  if (!Number.isSafeInteger(staffId) || staffId <= 0) return Response.json({ success: false, message: "직원을 찾을 수 없습니다." }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    const input = await request.json();
    body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  } catch { return Response.json({ success: false, message: "입력값을 확인해 주세요." }, { status: 400 }); }

  const loginId = normalizeAdminLoginId(body.loginId);
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!isValidAdminLoginId(loginId) || !isValidAdminPin(pin)) {
    return Response.json({ success: false, message: "아이디는 영문 소문자로 시작하는 3~32자, PIN은 숫자 6자리로 입력해 주세요." }, { status: 400 });
  }
  try {
    const [target] = await db.select({ staffId: staff.staffId }).from(staff).where(and(
      eq(staff.staffId, staffId), eq(staff.role, "OWNER"), eq(staff.isActive, 1), ne(staff.staffCode, "000"),
    )).limit(1);
    if (!target) return Response.json({ success: false, message: "활성 OWNER 직원을 찾을 수 없습니다." }, { status: 404 });
    const [duplicate] = await db.select({ staffId: staff.staffId }).from(staff).where(eq(staff.adminLoginId, loginId)).limit(1);
    if (duplicate && duplicate.staffId !== staffId) return Response.json({ success: false, message: "이미 사용 중인 관리센터 아이디입니다." }, { status: 409 });
    await db.update(staff).set({ adminLoginId: loginId, adminPinHash: await hashAdminPin(pin), updatedAt: new Date() }).where(eq(staff.staffId, staffId));
    return Response.json({ success: true });
  } catch (error) {
    const cause = error instanceof Error && "cause" in error ? error.cause : error;
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "ER_DUP_ENTRY") {
      return Response.json({ success: false, message: "이미 사용 중인 관리센터 아이디입니다." }, { status: 409 });
    }
    console.error("Admin credentials update failed", error);
    return Response.json({ success: false, message: "관리센터 로그인 정보를 설정하지 못했습니다." }, { status: 500 });
  }
}
