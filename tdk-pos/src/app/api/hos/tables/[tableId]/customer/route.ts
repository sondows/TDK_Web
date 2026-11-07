import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { customers, tableSessionMerges, tableSessions } from "@/db/schema";
import { getCurrentHosStaff } from "@/lib/hos-auth";

export async function POST(request: Request, { params }: { params: Promise<{ tableId: string }> }) {
  if (!await getCurrentHosStaff()) return Response.json({ success: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const tableId = Number((await params).tableId);
  if (!Number.isSafeInteger(tableId) || tableId <= 0) return Response.json({ success: false }, { status: 400 });
  const body = await request.json().catch(() => null) as { customerId?: unknown } | null;
  const customerId = body?.customerId === null ? null : Number(body?.customerId);
  if (customerId !== null && (!Number.isSafeInteger(customerId) || customerId <= 0)) return Response.json({ success: false }, { status: 400 });
  try {
    await db.transaction(async tx => {
      const [main] = await tx.select({ sessionId: tableSessions.sessionId, groupId: tableSessions.groupId })
        .from(tableSessions).where(and(eq(tableSessions.tableId, tableId), eq(tableSessions.status, "OPEN"),
          eq(tableSessions.sessionKind, "DINE_IN"))).limit(1).for("update");
      if (!main) throw new Error("SESSION_NOT_AVAILABLE");
      if (customerId !== null) {
        const [customer] = await tx.select({ customerId: customers.customerId }).from(customers)
          .where(and(eq(customers.customerId, customerId), eq(customers.isActive, 1))).limit(1);
        if (!customer) throw new Error("CUSTOMER_NOT_AVAILABLE");
      }
      const merges = await tx.select({ sourceSessionId: tableSessionMerges.sourceSessionId })
        .from(tableSessionMerges).where(and(eq(tableSessionMerges.destinationSessionId, main.sessionId),
          eq(tableSessionMerges.status, "ACTIVE")));
      const sessionIds = [main.sessionId, ...merges.map(row => row.sourceSessionId)];
      if (main.groupId !== null) {
        const groupSessions = await tx.select({ sessionId: tableSessions.sessionId }).from(tableSessions)
          .where(and(eq(tableSessions.groupId, main.groupId), eq(tableSessions.status, "OPEN"), eq(tableSessions.sessionKind, "DINE_IN")));
        sessionIds.push(...groupSessions.map(row => row.sessionId));
      }
      const uniqueIds = [...new Set(sessionIds)];
      const openSessions = await tx.select({ sessionId: tableSessions.sessionId }).from(tableSessions)
        .where(and(inArray(tableSessions.sessionId, uniqueIds), eq(tableSessions.status, "OPEN"), eq(tableSessions.sessionKind, "DINE_IN")));
      if (openSessions.length !== uniqueIds.length) throw new Error("SESSION_CHANGED");
      await tx.update(tableSessions).set({ pickupCustomerId: customerId, pickupName: customerId === null ? "" : null })
        .where(inArray(tableSessions.sessionId, uniqueIds));
    });
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === "CUSTOMER_NOT_AVAILABLE" ? 404 : code.startsWith("SESSION_") ? 409 : 503;
    console.error("HOS table customer update failed", { code: (error as { code?: string }).code ?? code });
    return Response.json({ success: false, message: code === "CUSTOMER_NOT_AVAILABLE" ? "고객을 찾을 수 없습니다." : "테이블 고객 연결을 저장하지 못했습니다. 새로고침 후 다시 확인해 주세요." },
      { status, headers: { "Cache-Control": "no-store" } });
  }
}
