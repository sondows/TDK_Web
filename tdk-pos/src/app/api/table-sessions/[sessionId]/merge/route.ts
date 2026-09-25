import { and, eq, or } from "drizzle-orm";

import { db } from "@/db";
import { diningTables, tableSessionMerges, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const currentStaff = await getCurrentStaff();
  const sharedMode = await getPosLoginMode() === "SHARED";
  if (!currentStaff && !sharedMode) {
    return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const sourceSessionId = Number((await params).sessionId);
  if (!Number.isInteger(sourceSessionId) || sourceSessionId <= 0) {
    return Response.json({ success: false, message: "유효한 합석 원본 세션이 필요합니다." }, { status: 400 });
  }

  try {
    const body = await request.json() as { destinationTableId?: unknown };
    const destinationTableId = Number(body.destinationTableId);
    if (!Number.isInteger(destinationTableId) || destinationTableId <= 0) {
      return Response.json({ success: false, message: "함께 앉을 테이블을 확인해 주세요." }, { status: 400 });
    }

    const result = await db.transaction(async (tx) => {
      const [source] = await tx.select({
        sessionId: tableSessions.sessionId,
        tableId: tableSessions.tableId,
      }).from(tableSessions)
        .where(and(eq(tableSessions.sessionId, sourceSessionId), eq(tableSessions.status, "OPEN")))
        .for("update")
        .limit(1);

      if (!source) return { error: "합석할 테이블의 OPEN 세션을 찾을 수 없습니다.", status: 409 as const };
      if (source.tableId === destinationTableId) return { error: "같은 테이블끼리는 합석할 수 없습니다.", status: 400 as const };

      const [destination] = await tx.select({
        sessionId: tableSessions.sessionId,
        tableId: tableSessions.tableId,
      }).from(tableSessions)
        .where(and(eq(tableSessions.tableId, destinationTableId), eq(tableSessions.status, "OPEN")))
        .for("update")
        .limit(1);
      if (!destination) return { error: "사용 중인 테이블을 선택해 주세요.", status: 409 as const };

      // A session may be a merge destination for several source tables, but a
      // source (or a nested destination) cannot start another merge.
      const [sourceAlreadyMerged] = await tx.select({ mergeId: tableSessionMerges.mergeId })
        .from(tableSessionMerges)
        .where(and(
          eq(tableSessionMerges.status, "ACTIVE"),
          or(eq(tableSessionMerges.sourceSessionId, source.sessionId), eq(tableSessionMerges.destinationSessionId, source.sessionId)),
        ))
        .for("update")
        .limit(1);
      if (sourceAlreadyMerged) return { error: "이 테이블은 현재 합석 관계에 있어 새 합석을 시작할 수 없습니다.", status: 409 as const };

      const [destinationIsSource] = await tx.select({ mergeId: tableSessionMerges.mergeId })
        .from(tableSessionMerges)
        .where(and(eq(tableSessionMerges.sourceSessionId, destination.sessionId), eq(tableSessionMerges.status, "ACTIVE")))
        .for("update")
        .limit(1);
      if (destinationIsSource) return { error: "합석 원본으로 사용 중인 테이블에는 합석할 수 없습니다.", status: 409 as const };

      const [sourceTable] = await tx.select({ tableNo: diningTables.tableNo }).from(diningTables)
        .where(eq(diningTables.tableId, source.tableId)).limit(1);
      const [destinationTable] = await tx.select({ tableNo: diningTables.tableNo }).from(diningTables)
        .where(eq(diningTables.tableId, destination.tableId)).limit(1);
      if (!sourceTable || !destinationTable) return { error: "테이블 정보를 찾을 수 없습니다.", status: 409 as const };

      await tx.insert(tableSessionMerges).values({
        sourceSessionId: source.sessionId,
        sourceTableId: source.tableId,
        destinationSessionId: destination.sessionId,
        destinationTableId: destination.tableId,
        status: "ACTIVE",
        mergedByStaffId: currentStaff?.staffId,
      });

      return { sourceTableNo: sourceTable.tableNo, destinationTableNo: destinationTable.tableNo };
    });

    if ("error" in result) return Response.json({ success: false, message: result.error }, { status: result.status });
    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error("table session merge failed", error);
    return Response.json({ success: false, message: "합석 처리에 실패했습니다." }, { status: 500 });
  }
}
