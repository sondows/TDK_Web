import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { hashPin } from "@/lib/auth";
import { canManageStaff, getPrivilegedStaff } from "@/lib/permissions";
import { isValidPin } from "@/lib/pin";

const roles = new Set(["OWNER", "MANAGER", "STAFF"]);
async function requireOwner() {
  const member = await getPrivilegedStaff();
  return member && canManageStaff(member.role) ? member : null;
}
const parse = (body: Record<string, unknown>) => ({
  staffCode: typeof body.staffCode === "string" ? body.staffCode.trim() : "",
  name: typeof body.name === "string" ? body.name.trim() : "",
  role: typeof body.role === "string" && roles.has(body.role) ? body.role as "OWNER" | "MANAGER" | "STAFF" : null,
  pin: typeof body.pin === "string" ? body.pin : "",
  isActive: body.isActive === false ? 0 : 1,
});

export async function GET() {
  if (!await requireOwner()) return Response.json({ success: false, message: "OWNER 권한이 필요합니다." }, { status: 403 });
  try {
    const rows = await db.select({ staffId: staff.staffId, staffCode: staff.staffCode, name: staff.name, role: staff.role, isActive: staff.isActive, hasPin: staff.pinHash }).from(staff).orderBy(asc(staff.staffCode));
    return Response.json({ success: true, staff: rows.map(row => ({ ...row, hasPin: Boolean(row.hasPin), isShared: row.staffCode === "000" })) });
  } catch {
    return Response.json({ success: false, message: "직원 목록을 불러올 수 없습니다. staff.cancel_requires_pin 컬럼이 생성되었는지 확인하세요." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!await requireOwner()) return Response.json({ success: false, message: "OWNER 권한이 필요합니다." }, { status: 403 });
  try {
    const values = parse(await request.json() as Record<string, unknown>);
    if (!values.staffCode || values.staffCode === "000" || values.staffCode.length > 30 || !values.name || values.name.length > 100 || !values.role || !isValidPin(values.pin)) return Response.json({ success: false, message: "직원코드, 이름, 역할, 숫자 4자리 PIN을 확인하세요." }, { status: 400 });
    const [exists] = await db.select({ id: staff.staffId }).from(staff).where(eq(staff.staffCode, values.staffCode)).limit(1);
    if (exists) return Response.json({ success: false, message: "이미 사용 중인 직원코드입니다." }, { status: 409 });
    const pinHash = await hashPin(values.pin);
    const inserted = await db.insert(staff).values({ staffCode: values.staffCode, name: values.name, role: values.role, pinHash, isActive: values.isActive });
    return Response.json({ success: true, staffId: Number(inserted[0].insertId) }, { status: 201 });
  } catch { return Response.json({ success: false, message: "직원을 등록할 수 없습니다." }, { status: 400 }); }
}
