import { eq } from "drizzle-orm";
import { db } from "@/db";
import { diningTables } from "@/db/schema";
import { getManagementOwner } from "@/lib/management-auth";
import { isValidStoredTableSize } from "@/lib/table-layout";

type Layout = { tableId: number; positionX: number; positionY: number; layoutWidth: number; layoutHeight: number; rotation: number; tableName?: string; capacity?: number; isActive?: number };
const valid = (value: unknown, min: number, max: number) => Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;

export async function PUT(request: Request) {
  const staff = await getManagementOwner();
  if (!staff) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  if (staff.role !== "OWNER") return Response.json({ success: false, message: "OWNER만 테이블 배치를 저장할 수 있습니다." }, { status: 403 });
  try {
    const body = await request.json() as { layouts?: Layout[] };
    if (!Array.isArray(body.layouts) || body.layouts.length > 200) throw new Error("invalid");
    const layouts = body.layouts;
    await db.transaction(async (tx) => {
      for (const item of layouts) {
        if (!Number.isInteger(item.tableId) || !valid(item.positionX, 0, 100) || !valid(item.positionY, 0, 100) || !isValidStoredTableSize(item.layoutWidth, "width") || !isValidStoredTableSize(item.layoutHeight, "height") || ![0, 90, 180, 270].includes(Number(item.rotation))) throw new Error("invalid");
        const capacity = Number(item.capacity);
        await tx.update(diningTables).set({ positionX: String(item.positionX), positionY: String(item.positionY), layoutWidth: String(item.layoutWidth), layoutHeight: String(item.layoutHeight), rotation: Number(item.rotation), ...(Number.isInteger(capacity) && capacity >= 0 ? { capacity } : {}) }).where(eq(diningTables.tableId, item.tableId));
      }
    });
    return Response.json({ success: true });
  } catch { return Response.json({ success: false, message: "배치 정보를 저장할 수 없습니다." }, { status: 400 }); }
}
