import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { diningTables, partyGroups, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";

export async function POST(request: Request) {
  const currentStaff = await getCurrentStaff();
  const sharedMode = await getPosLoginMode() === "SHARED";
  if (!currentStaff && !sharedMode) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });

  try {
    const body = await request.json() as { tableIds?: unknown };
    const tableIds = Array.isArray(body.tableIds) ? body.tableIds.map(Number) : [];
    const uniqueTableIds = [...new Set(tableIds)];
    if (uniqueTableIds.length < 2 || uniqueTableIds.some(tableId => !Number.isInteger(tableId) || tableId <= 0)) {
      return Response.json({ success: false, message: "일행으로 지정할 테이블을 2개 이상 선택해 주세요." }, { status: 400 });
    }

    const result = await db.transaction(async (tx) => {
      const tables = await tx.select({ tableId: diningTables.tableId, tableNo: diningTables.tableNo })
        .from(diningTables)
        .where(and(inArray(diningTables.tableId, uniqueTableIds), eq(diningTables.isActive, 1)));
      if (tables.length !== uniqueTableIds.length) return { error: "선택된 테이블을 찾을 수 없습니다.", status: 404 as const };

      const sessions = await tx.select({ sessionId: tableSessions.sessionId, tableId: tableSessions.tableId, groupId: tableSessions.groupId })
        .from(tableSessions)
        .where(and(inArray(tableSessions.tableId, uniqueTableIds), eq(tableSessions.status, "OPEN")));
      if (sessions.length !== uniqueTableIds.length) return { error: "선택된 테이블의 이용 상태가 변경되었습니다. 다시 확인해 주세요.", status: 409 as const };

      const tableNoById = new Map(tables.map(table => [table.tableId, table.tableNo]));
      const groupedSession = sessions.find(session => session.groupId !== null);
      if (groupedSession) {
        return { error: "기존 일행 테이블은 선택할 수 없습니다.", status: 409 as const };
      }

      const inserted = await tx.insert(partyGroups).values({ status: "ACTIVE", createdByStaffId: currentStaff?.staffId ?? null });
      const groupId = Number(inserted[0].insertId);
      const updated = await tx.update(tableSessions)
        .set({ groupId })
        .where(and(inArray(tableSessions.sessionId, sessions.map(session => session.sessionId)), eq(tableSessions.status, "OPEN")));
      if (updated[0].affectedRows !== sessions.length) throw new Error("OPEN_SESSION_CHANGED");

      return { groupId, tableNos: uniqueTableIds.map(tableId => tableNoById.get(tableId) ?? String(tableId)) };
    });

    if ("error" in result) return Response.json({ success: false, message: result.error }, { status: result.status });
    return Response.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof Error && error.message === "OPEN_SESSION_CHANGED") {
      return Response.json({ success: false, message: "선택된 테이블의 이용 상태가 변경되었습니다. 다시 확인해 주세요." }, { status: 409 });
    }
    return Response.json({ success: false, message: "일행 지정 처리에 실패했습니다." }, { status: 500 });
  }
}
