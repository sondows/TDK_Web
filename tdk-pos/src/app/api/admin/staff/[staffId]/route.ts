import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { hashPin } from "@/lib/auth";
import { canManageStaff, getPrivilegedStaff } from "@/lib/permissions";
import { isValidPin } from "@/lib/pin";

const roles = new Set(["OWNER", "MANAGER", "STAFF"]);
export async function PATCH(request: Request, { params }: { params: Promise<{ staffId: string }> }) {
  const actor = await getPrivilegedStaff();
  if (!actor || !canManageStaff(actor.role)) return Response.json({ success: false, message: "OWNER 권한이 필요합니다." }, { status: 403 });
  try {
    const staffId = Number((await params).staffId);
    const body = await request.json() as Record<string, unknown>;
    if (!Number.isInteger(staffId) || staffId <= 0) return Response.json({ success: false, message: "직원을 찾을 수 없습니다." }, { status: 404 });
    const [target] = await db.select({ staffId: staff.staffId, staffCode: staff.staffCode, role: staff.role, isActive: staff.isActive }).from(staff).where(eq(staff.staffId, staffId)).limit(1);
    if (!target) return Response.json({ success: false, message: "직원을 찾을 수 없습니다." }, { status: 404 });
    if (target.staffCode === "000") return Response.json({ success: false, message: "매장 공용 계정은 수정할 수 없습니다." }, { status: 400 });
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const role = typeof body.role === "string" && roles.has(body.role) ? body.role as "OWNER" | "MANAGER" | "STAFF" : null;
    const isActive = body.isActive === false ? 0 : 1;
    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!name || name.length > 100 || !role || (pin && !isValidPin(pin))) return Response.json({ success: false, message: "직원 정보와 숫자 4자리 PIN을 확인하세요." }, { status: 400 });
    const removesOwner = target.role === "OWNER" && (role !== "OWNER" || isActive === 0);
    if (removesOwner) {
      const activeOwners = await db.select({ staffId: staff.staffId }).from(staff).where(and(eq(staff.role, "OWNER"), eq(staff.isActive, 1)));
      if (activeOwners.length <= 1) return Response.json({ success: false, message: "최소 한 명의 사용 가능한 OWNER가 필요합니다." }, { status: 409 });
    }
    await db.update(staff).set({ name, role, isActive, ...(pin ? { pinHash: await hashPin(pin) } : {}), updatedAt: new Date() }).where(eq(staff.staffId, staffId));
    return Response.json({ success: true });
  } catch { return Response.json({ success: false, message: "직원 정보를 저장할 수 없습니다." }, { status: 400 }); }
}
