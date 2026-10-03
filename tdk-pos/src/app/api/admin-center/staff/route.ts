import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { hashAdminPin, hashPin } from "@/lib/auth";
import { isDuplicateAdminLoginId, newInternalStaffCode, parseStaffDraft, staffColumns, toStaffSummary } from "@/lib/staff-management-server";

export async function GET() {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "OWNER 로그인이 필요합니다." }, { status: 401 });
  try {
    const rows = await db.select(staffColumns).from(staff).orderBy(asc(staff.staffCode));
    return Response.json({ success: true, staff: rows.map(toStaffSummary) });
  } catch (error) {
    console.error("Admin staff list failed", error);
    return Response.json({ success: false, message: "직원 목록을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "OWNER 로그인이 필요합니다." }, { status: 401 });
  let parsed: ReturnType<typeof parseStaffDraft>;
  try { parsed = parseStaffDraft(await request.json()); }
  catch { return Response.json({ success: false, message: "요청 형식을 확인해 주세요." }, { status: 400 }); }
  if (!parsed) return Response.json({ success: false, message: "요청 형식을 확인해 주세요." }, { status: 400 });
  if (!parsed.valid) return Response.json({ success: false, errors: parsed.errors, message: "입력 내용을 확인해 주세요." }, { status: 400 });
  const { draft } = parsed;
  try {
    if (draft.adminEnabled) {
      const [duplicate] = await db.select({ id: staff.staffId }).from(staff).where(eq(staff.adminLoginId, draft.adminLoginId)).limit(1);
      if (duplicate) return Response.json({ success: false, errors: { adminLoginId: "이미 사용 중인 관리센터 아이디입니다." } }, { status: 409 });
    }
    const pinHash = draft.posEnabled ? await hashPin(draft.posPin) : null;
    const adminPinHash = draft.adminEnabled ? await hashAdminPin(draft.adminPin) : null;
    const staffId = await db.transaction(async tx => {
      const result = await tx.insert(staff).values({
        staffCode: newInternalStaffCode(), name: draft.name, role: draft.role,
        isActive: draft.isActive ? 1 : 0, pinHash,
        adminLoginId: draft.adminEnabled ? draft.adminLoginId : null, adminPinHash,
      });
      return Number(result[0].insertId);
    });
    return Response.json({ success: true, staffId }, { status: 201 });
  } catch (error) {
    if (isDuplicateAdminLoginId(error)) return Response.json({ success: false, errors: { adminLoginId: "이미 사용 중인 관리센터 아이디입니다." } }, { status: 409 });
    console.error("Admin staff create failed", error);
    return Response.json({ success: false, message: "직원을 등록하지 못했습니다." }, { status: 500 });
  }
}
