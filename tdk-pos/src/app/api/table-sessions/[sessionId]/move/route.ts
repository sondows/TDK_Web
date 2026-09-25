import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { diningTables, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";

export async function PATCH(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const currentStaff = await getCurrentStaff();
  const sharedMode = await getPosLoginMode() === "SHARED";
  if (!currentStaff && !sharedMode) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });

  const sourceSessionId = Number((await params).sessionId);
  if (!Number.isInteger(sourceSessionId) || sourceSessionId <= 0) {
    return Response.json({ success: false, message: "유효한 원본 세션이 필요합니다." }, { status: 400 });
  }

  try {
    const body = await request.json() as { destinationTableId?: unknown };
    const destinationTableId = Number(body.destinationTableId);
    if (!Number.isInteger(destinationTableId) || destinationTableId <= 0) {
      return Response.json({ success: false, message: "유효한 목적지 테이블이 필요합니다." }, { status: 400 });
    }

    const result = await db.transaction(async (tx) => {
      const [source] = await tx.select({ sessionId: tableSessions.sessionId, tableId: tableSessions.tableId })
        .from(tableSessions)
        .where(and(eq(tableSessions.sessionId, sourceSessionId), eq(tableSessions.status, "OPEN")))
        .limit(1);
      if (!source) return { error: "원본 테이블의 사용 중인 세션을 찾을 수 없습니다.", status: 404 as const };
      if (source.tableId === destinationTableId) return { error: "현재 선택된 테이블과 같은 테이블입니다.", status: 400 as const };

      const [destination] = await tx.select({ tableId: diningTables.tableId, tableNo: diningTables.tableNo })
        .from(diningTables)
        .where(and(eq(diningTables.tableId, destinationTableId), eq(diningTables.isActive, 1)))
        .limit(1);
      if (!destination) return { error: "목적지 테이블을 찾을 수 없습니다.", status: 404 as const };

      const [occupied] = await tx.select({ sessionId: tableSessions.sessionId })
        .from(tableSessions)
        .where(and(eq(tableSessions.tableId, destinationTableId), eq(tableSessions.status, "OPEN")))
        .limit(1);
      if (occupied) return { error: `${destination.tableNo}번 테이블은 사용 중입니다. 빈 테이블을 선택해 주세요.`, status: 409 as const };

      const updated = await tx.update(tableSessions)
        .set({ tableId: destinationTableId })
        .where(and(eq(tableSessions.sessionId, sourceSessionId), eq(tableSessions.status, "OPEN")));
      if (updated[0].affectedRows !== 1) return { error: "이동 중 테이블 상태가 변경되었습니다. 다시 시도해 주세요.", status: 409 as const };
      return { destinationTableId, sourceTableId: source.tableId };
    });

    if ("error" in result) return Response.json({ success: false, message: result.error }, { status: result.status });
    return Response.json({ success: true, ...result });
  } catch {
    return Response.json({ success: false, message: "테이블 이동 처리에 실패했습니다." }, { status: 500 });
  }
}
