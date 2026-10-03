import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { hashAdminPin, hashPin } from "@/lib/auth";
import { isDuplicateAdminLoginId, parseStaffDraft, staffColumns, toStaffSummary } from "@/lib/staff-management-server";
import { isValidPin } from "@/lib/pin";

export async function PATCH(request: Request, { params }: { params: Promise<{ staffId: string }> }) {
  const actor = await getCurrentAdminStaff();
  if (!actor) return Response.json({ success: false, message: "OWNER 로그인이 필요합니다." }, { status: 401 });
  const id = Number((await params).staffId);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ success: false, message: "직원을 찾을 수 없습니다." }, { status: 404 });
  let input: unknown;
  try { input = await request.json(); }
  catch { return Response.json({ success: false, message: "요청 형식을 확인해 주세요." }, { status: 400 }); }
  try {
    const result = await db.transaction(async tx => {
      const [target] = await tx.select(staffColumns).from(staff).where(eq(staff.staffId, id)).limit(1).for("update");
      if (!target) return { status: 404, body: { success: false, message: "직원을 찾을 수 없습니다." } };
      if (target.staffCode === "000") {
        if (!input || typeof input !== "object" || Array.isArray(input)) return { status: 400, body: { success: false, message: "PIN을 확인해 주세요." } };
        const sharedInput = input as Record<string, unknown>;
        if (Object.keys(sharedInput).some(key => key !== "posPin" && key !== "posPinConfirm")) return { status: 403, body: { success: false, message: "매장 공용 계정은 POS PIN만 변경할 수 있습니다." } };
        if (typeof sharedInput.posPin !== "string" || !isValidPin(sharedInput.posPin) || sharedInput.posPin !== sharedInput.posPinConfirm) return { status: 400, body: { success: false, message: "POS PIN은 일치하는 숫자 4자리여야 합니다." } };
        await tx.update(staff).set({ pinHash: await hashPin(sharedInput.posPin), updatedAt: new Date() }).where(eq(staff.staffId, id));
        return { status: 200, body: { success: true } };
      }
      if (input && typeof input === "object" && !Array.isArray(input) &&
          Object.keys(input).length === 1 && (input as Record<string, unknown>).isActive === false) {
        if (id === actor.staffId) return { status: 409, body: { success: false, message: "현재 로그인한 OWNER 본인은 사용중지할 수 없습니다." } };
        await tx.update(staff).set({ isActive: 0, updatedAt: new Date() }).where(eq(staff.staffId, id));
        return { status: 200, body: { success: true } };
      }
      const parsed = parseStaffDraft(input, toStaffSummary(target));
      if (!parsed) return { status: 400, body: { success: false, message: "요청 형식을 확인해 주세요." } };
      if (!parsed.valid) return { status: 400, body: { success: false, errors: parsed.errors, message: "입력 내용을 확인해 주세요." } };
      const { draft } = parsed;
      if (id === actor.staffId && (draft.role !== "OWNER" || !draft.isActive || !draft.adminEnabled)) {
        return { status: 409, body: { success: false, message: "현재 로그인한 OWNER 본인의 사용이나 관리센터 권한을 해제할 수 없습니다." } };
      }
      const removesOwner = target.role === "OWNER" && target.isActive === 1 && (draft.role !== "OWNER" || !draft.isActive || !draft.adminEnabled);
      if (removesOwner) {
        const otherOwners = await tx.select({ id: staff.staffId }).from(staff).where(and(
          eq(staff.role, "OWNER"), eq(staff.isActive, 1), ne(staff.staffId, id),
          isNotNull(staff.adminLoginId), isNotNull(staff.adminPinHash),
        ));
        if (!otherOwners.length) return { status: 409, body: { success: false, message: "마지막 사용 중인 OWNER는 비활성화할 수 없습니다." } };
      }
      if (draft.adminEnabled && draft.adminLoginId !== target.adminLoginId) {
        const [duplicate] = await tx.select({ id: staff.staffId }).from(staff).where(eq(staff.adminLoginId, draft.adminLoginId)).limit(1);
        if (duplicate) return { status: 409, body: { success: false, errors: { adminLoginId: "이미 사용 중인 관리센터 아이디입니다." } } };
      }
      await tx.update(staff).set({
        name: draft.name, role: draft.role, isActive: draft.isActive ? 1 : 0,
        pinHash: draft.posEnabled ? (draft.posPin ? await hashPin(draft.posPin) : target.pinHash) : null,
        adminLoginId: draft.adminEnabled ? draft.adminLoginId : null,
        adminPinHash: draft.adminEnabled ? (draft.adminPin ? await hashAdminPin(draft.adminPin) : target.adminPinHash) : null,
        updatedAt: new Date(),
      }).where(eq(staff.staffId, id));
      return { status: 200, body: { success: true } };
    });
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    if (isDuplicateAdminLoginId(error)) return Response.json({ success: false, errors: { adminLoginId: "이미 사용 중인 관리센터 아이디입니다." } }, { status: 409 });
    console.error("Admin staff update failed", error);
    return Response.json({ success: false, message: "직원 정보를 저장하지 못했습니다." }, { status: 500 });
  }
}
