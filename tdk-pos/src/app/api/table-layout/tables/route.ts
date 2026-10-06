import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { diningTables, tableSessions } from "@/db/schema";
import { getManagementOwner } from "@/lib/management-auth";

async function requireOwner() {
  const staff = await getManagementOwner();
  if (!staff) return { error: Response.json({ message: "로그인이 필요합니다." }, { status: 401 }) };
  if (staff.role !== "OWNER") return { error: Response.json({ message: "OWNER만 이 작업을 할 수 있습니다." }, { status: 403 }) };
  return { staff };
}

export async function POST(request: Request) {
  const auth = await requireOwner(); if (auth.error) return auth.error;
  try {
    const body = await request.json() as { tableNo?: string; capacity?: number; sourceTableId?: number };
    const tableNo = body.tableNo?.trim(); const capacity = Number(body.capacity);
    if (!tableNo || tableNo.length > 20 || !Number.isInteger(capacity) || capacity < 0 || capacity > 100) return Response.json({ message: "테이블 정보를 확인해 주세요." }, { status: 400 });
    const existing = await db.select({ tableId: diningTables.tableId }).from(diningTables).where(eq(diningTables.tableNo, tableNo)).limit(1);
    if (existing.length) return Response.json({ message: "이미 사용 중인 테이블 번호입니다." }, { status: 409 });
    const sourceTableId = Number(body.sourceTableId);
    const source = Number.isInteger(sourceTableId) ? (await db.select().from(diningTables).where(eq(diningTables.tableId, sourceTableId)).limit(1))[0] : undefined;
    const latest = await db.select({ sortOrder: diningTables.sortOrder }).from(diningTables).orderBy(desc(diningTables.sortOrder)).limit(1);
    const baseX = Number(source?.positionX ?? 50); const baseY = Number(source?.positionY ?? 50);
    const result = await db.insert(diningTables).values({ tableNo, tableName: `${tableNo}번 테이블`, capacity, positionX: String(Math.min(94, baseX + (source ? 4 : 0))), positionY: String(Math.min(94, baseY + (source ? 4 : 0))), layoutWidth: source?.layoutWidth ?? "20", layoutHeight: source?.layoutHeight ?? "14", rotation: source?.rotation ?? 0, sortOrder: (latest[0]?.sortOrder ?? 0) + 1, isActive: 1 });
    const tableId = Number(result[0].insertId);
    const table = (await db.select().from(diningTables).where(eq(diningTables.tableId, tableId)).limit(1))[0];
    return Response.json({ table }, { status: 201 });
  } catch { return Response.json({ message: "테이블을 추가할 수 없습니다." }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  const auth = await requireOwner(); if (auth.error) return auth.error;
  try {
    const { tableId } = await request.json() as { tableId?: number };
    const parsedTableId = Number(tableId);
    if (!Number.isInteger(parsedTableId)) return Response.json({ message: "잘못된 테이블입니다." }, { status: 400 });
    const openSession = await db.select({ sessionId: tableSessions.sessionId }).from(tableSessions).where(sql`${tableSessions.tableId} = ${tableId} and ${tableSessions.status} = 'OPEN'`).limit(1);
    if (openSession.length) return Response.json({ message: "OPEN 테이블은 비활성화할 수 없습니다." }, { status: 409 });
    await db.update(diningTables).set({ isActive: 0 }).where(eq(diningTables.tableId, parsedTableId));
    return Response.json({ success: true });
  } catch { return Response.json({ message: "비활성화할 수 없습니다." }, { status: 400 }); }
}
