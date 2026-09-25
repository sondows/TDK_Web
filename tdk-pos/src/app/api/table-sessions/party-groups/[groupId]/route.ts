import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { diningTables, partyGroups, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";

export async function DELETE(_request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const currentStaff = await getCurrentStaff();
  const sharedMode = await getPosLoginMode() === "SHARED";
  if (!currentStaff && !sharedMode) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });

  const groupId = Number((await params).groupId);
  if (!Number.isInteger(groupId) || groupId <= 0) return Response.json({ success: false, message: "유효한 일행 정보가 필요합니다." }, { status: 400 });

  try {
    const result = await db.transaction(async (tx) => {
      const [group] = await tx.select({ groupId: partyGroups.groupId })
        .from(partyGroups)
        .where(eq(partyGroups.groupId, groupId))
        .limit(1);
      if (!group) return { error: "일행 정보를 찾을 수 없습니다.", status: 404 as const };

      const sessions = await tx.select({ sessionId: tableSessions.sessionId, tableNo: diningTables.tableNo })
        .from(tableSessions)
        .innerJoin(diningTables, eq(tableSessions.tableId, diningTables.tableId))
        .where(and(eq(tableSessions.groupId, groupId), eq(tableSessions.status, "OPEN"), eq(diningTables.isActive, 1)));
      if (sessions.length < 2) return { error: "일행 정보가 변경되었습니다. 다시 선택해 주세요.", status: 409 as const };

      const updated = await tx.update(tableSessions)
        .set({ groupId: null })
        .where(and(eq(tableSessions.groupId, groupId), eq(tableSessions.status, "OPEN")));
      if (updated[0].affectedRows !== sessions.length) throw new Error("PARTY_GROUP_CHANGED");

      return { tableNos: sessions.map(session => session.tableNo).sort((a, b) => a.localeCompare(b, "ko", { numeric: true })) };
    });

    if ("error" in result) return Response.json({ success: false, message: result.error }, { status: result.status });
    return Response.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof Error && error.message === "PARTY_GROUP_CHANGED") {
      return Response.json({ success: false, message: "일행 정보가 변경되었습니다. 다시 선택해 주세요." }, { status: 409 });
    }
    return Response.json({ success: false, message: "일행 취소 처리에 실패했습니다." }, { status: 500 });
  }
}
