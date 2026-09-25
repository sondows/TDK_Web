import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { diningTables, tableSessionMerges, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";

export async function POST(request: Request, { params }: { params: Promise<{ mergeId: string }> }) {
  const currentStaff = await getCurrentStaff();
  const sharedMode = await getPosLoginMode() === "SHARED";
  if (!currentStaff && !sharedMode) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });

  const mergeId = Number((await params).mergeId);
  if (!Number.isInteger(mergeId) || mergeId <= 0) return Response.json({ success: false, message: "유효한 합석 관계가 필요합니다." }, { status: 400 });

  try {
    const body = await request.json() as { destinationTableId?: unknown };
    const destinationTableId = Number(body.destinationTableId);
    if (!Number.isInteger(destinationTableId) || destinationTableId <= 0) {
      return Response.json({ success: false, message: "분리할 빈 테이블을 선택해 주세요." }, { status: 400 });
    }

    const result = await db.transaction(async (tx) => {
      const [merge] = await tx.select({
        mergeId: tableSessionMerges.mergeId,
        sourceSessionId: tableSessionMerges.sourceSessionId,
        sourceTableId: tableSessionMerges.sourceTableId,
        destinationTableId: tableSessionMerges.destinationTableId,
      }).from(tableSessionMerges)
        .where(and(eq(tableSessionMerges.mergeId, mergeId), eq(tableSessionMerges.status, "ACTIVE")))
        .for("update")
        .limit(1);
      if (!merge) return { error: "합석 정보가 변경되었습니다. 다시 선택해 주세요.", status: 409 as const };

      const [source] = await tx.select({ sessionId: tableSessions.sessionId, tableId: tableSessions.tableId })
        .from(tableSessions)
        .where(and(eq(tableSessions.sessionId, merge.sourceSessionId), eq(tableSessions.status, "OPEN")))
        .for("update")
        .limit(1);
      if (!source) return { error: "분리할 source session이 OPEN 상태가 아닙니다.", status: 409 as const };

      const [destinationTable] = await tx.select({ tableId: diningTables.tableId, tableNo: diningTables.tableNo })
        .from(diningTables)
        .where(and(eq(diningTables.tableId, destinationTableId), eq(diningTables.isActive, 1)))
        .for("update")
        .limit(1);
      if (!destinationTable) return { error: "분리 목적 테이블을 찾을 수 없습니다.", status: 404 as const };

      const destinationOpenSessions = await tx.select({ sessionId: tableSessions.sessionId })
        .from(tableSessions)
        .where(and(eq(tableSessions.tableId, destinationTableId), eq(tableSessions.status, "OPEN")))
        .for("update");
      if (destinationOpenSessions.some(session => session.sessionId !== source.sessionId)) {
        return { error: "테이블 상태가 변경되었습니다. 다른 빈 테이블을 선택해 주세요.", status: 409 as const };
      }

      const [sourceTable] = await tx.select({ tableNo: diningTables.tableNo }).from(diningTables)
        .where(eq(diningTables.tableId, merge.sourceTableId)).limit(1);
      const [mergedTable] = await tx.select({ tableNo: diningTables.tableNo }).from(diningTables)
        .where(eq(diningTables.tableId, merge.destinationTableId)).limit(1);
      if (!sourceTable || !mergedTable) return { error: "합석 테이블 정보를 찾을 수 없습니다.", status: 409 as const };

      const moved = await tx.update(tableSessions).set({ tableId: destinationTableId })
        .where(and(eq(tableSessions.sessionId, source.sessionId), eq(tableSessions.status, "OPEN")));
      if (moved[0].affectedRows !== 1) return { error: "테이블 상태가 변경되었습니다. 다시 선택해 주세요.", status: 409 as const };
      const separated = await tx.update(tableSessionMerges).set({ status: "SEPARATED", separatedAt: new Date() })
        .where(and(eq(tableSessionMerges.mergeId, merge.mergeId), eq(tableSessionMerges.status, "ACTIVE")));
      if (separated[0].affectedRows !== 1) return { error: "합석 상태가 변경되었습니다. 다시 선택해 주세요.", status: 409 as const };

      return { mergedTableNo: mergedTable.tableNo, sourceTableNo: sourceTable.tableNo, destinationTableNo: destinationTable.tableNo };
    });

    if ("error" in result) return Response.json({ success: false, message: result.error }, { status: result.status });
    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error("table session merge separation failed", error);
    return Response.json({ success: false, message: "합석 분리 처리에 실패했습니다." }, { status: 500 });
  }
}
