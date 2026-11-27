import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, diningTables, qrOrders, qrSessionInvites, qrSessions, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getCurrentHosStaff } from "@/lib/hos-auth";
import { isKnownInternalHost } from "@/lib/host-access";
import { isHttpsSameOriginRequest, isSameOriginRequest } from "@/lib/kds-device";
import { shouldBlockQrTokenCancellation } from "@/lib/qr-processing-policy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Production also serves POS/HOS on configured internal HTTP hosts.
  const sameOrigin = isHttpsSameOriginRequest(request) ||
    (isKnownInternalHost(request.headers.get("host")) && isSameOriginRequest(request));
  if (!sameOrigin) {
    return Response.json({ success: false, message: "허용되지 않은 요청 출처입니다." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const actor = await getCurrentStaff() ?? await getCurrentHosStaff();
  if (!actor) {
    return Response.json({ success: false, message: "POS 또는 HOS 로그인이 필요합니다." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const body = await request.json().catch(() => null) as { tableId?: unknown } | null;
  const tableId = Number(body?.tableId);
  if (!Number.isSafeInteger(tableId) || tableId <= 0) {
    return Response.json({ success: false, message: "유효한 테이블을 지정해 주세요." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const result = await db.transaction(async tx => {
      const [table] = await tx.select({ tableId: diningTables.tableId, isActive: diningTables.isActive })
        .from(diningTables).where(eq(diningTables.tableId, tableId)).for("update").limit(1);
      if (!table || table.isActive !== 1) return { kind: "TABLE_NOT_FOUND" as const };

      const tableSessionsForTable = await tx.select({ sessionId: tableSessions.sessionId })
        .from(tableSessions).where(eq(tableSessions.tableId, tableId)).for("update");
      const sessionIds = tableSessionsForTable.map(row => Number(row.sessionId));
      const sessionScope = sessionIds.length
        ? or(eq(qrSessions.tableId, tableId), inArray(qrSessions.sessionId, sessionIds))!
        : eq(qrSessions.tableId, tableId);
      const relatedQrSessions = await tx.select({ qrSessionId: qrSessions.qrSessionId, status: qrSessions.status })
        .from(qrSessions).where(sessionScope).for("update");
      const qrSessionIds = relatedQrSessions.map(row => Number(row.qrSessionId));
      const pendingOrders = qrSessionIds.length ? await tx.select({ qrOrderId: qrOrders.qrOrderId })
        .from(qrOrders).where(and(eq(qrOrders.status, "PENDING"), inArray(qrOrders.qrSessionId, qrSessionIds))) : [];
      if (shouldBlockQrTokenCancellation(pendingOrders.length)) {
        return { kind: "PENDING_ORDERS" as const, count: pendingOrders.length };
      }

      const now = new Date();
      const activeQrSessionIds = relatedQrSessions.filter(row => row.status === "ACTIVE").map(row => Number(row.qrSessionId));
      if (activeQrSessionIds.length) await tx.update(qrSessions).set({ status: "CLOSED", closedAt: now })
        .where(and(inArray(qrSessions.qrSessionId, activeQrSessionIds), eq(qrSessions.status, "ACTIVE")));
      if (sessionIds.length) await tx.update(qrSessionInvites).set({ revokedAt: now })
        .where(and(inArray(qrSessionInvites.sessionId, sessionIds), isNull(qrSessionInvites.revokedAt)));

      await tx.insert(auditLogs).values({
        staffId: actor.staffId,
        actionType: "QR_TABLE_TOKEN_CANCELLED",
        entityType: "DINING_TABLE",
        entityId: tableId,
        description: `result=success;closedQrSessions=${activeQrSessionIds.length}`,
        createdAt: now,
      });

      return { kind: "CANCELLED" as const };
    });

    if (result.kind === "TABLE_NOT_FOUND") {
      return Response.json({ success: false, message: "사용할 수 있는 테이블을 찾을 수 없습니다." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    if (result.kind === "PENDING_ORDERS") {
      return Response.json({ success: false, pendingCount: result.count,
        message: "미처리 QR 주문 " + result.count + "건이 있습니다. 주문을 먼저 승인하거나 거절한 뒤 QR 토큰을 취소해 주세요." },
      { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ success: true, fixedStickerPreserved: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("QR table token cancellation failed", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "QR 토큰을 취소하지 못했습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
