import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, diningTables, orders, qrCodes, qrOrders, qrSessions, qrTableLinks, tableSessions } from "@/db/schema";
import { createQrAccessToken, getQrAccessTokenFromCookies, hashQrToken, qrSessionRedirectResponse, resolveQrOrderSession } from "@/lib/qr-order-auth";
import { recordQrAccess, type QrAccessFailureType } from "@/lib/qr-access-log";
import { qrCustomerRedirectUrl } from "@/lib/qr-customer-redirect";

export const dynamic = "force-dynamic";

const unavailable = (request: Request) => Response.redirect(qrCustomerRedirectUrl(request, "/qrorder/unavailable"));
const serviceUnavailable = (request: Request) => Response.redirect(qrCustomerRedirectUrl(request, "/qrorder/service-unavailable"));

function logQrAccessError(phase: string, qrCodeId: number | null, error: unknown) {
  const rootCause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const detail = rootCause as Error & { code?: string; errno?: number; sqlState?: string };
  console.error("QR customer entry failed", {
    phase,
    qrCodeId,
    name: rootCause instanceof Error ? rootCause.name : undefined,
    message: rootCause instanceof TypeError ? rootCause.message : undefined,
    code: detail?.code,
    errno: detail?.errno,
    sqlState: detail?.sqlState,
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ identifier: string }> }) {
  const identifier = (await params).identifier;
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{16}$/.test(identifier)) return unavailable(request);

  let loggedQrCodeId: number | null = null;
  let authEventRecorded = false;
  try {
    const [qr] = await db.select({ qrCodeId: qrCodes.qrCodeId, targetType: qrCodes.targetType, status: qrCodes.status, tableId: qrTableLinks.tableId })
      .from(qrCodes).leftJoin(qrTableLinks, eq(qrTableLinks.qrCodeId, qrCodes.qrCodeId)).where(eq(qrCodes.identifier, identifier)).limit(1);
    if (!qr) return unavailable(request);

    const qrCodeId = Number(qr.qrCodeId);
    const isCurrentTableQr = qr.targetType === "TABLE_ORDER";
    let wasTableQr = isCurrentTableQr;
    if (!wasTableQr && (qr.status === "RETIRED" || qr.status === "LOCKED")) {
      const [priorAssignment] = await db.select({ auditLogId: auditLogs.auditLogId }).from(auditLogs)
        .where(and(eq(auditLogs.entityType, "QR_CODE"), eq(auditLogs.entityId, qrCodeId), eq(auditLogs.actionType, "QR_TABLE_ASSIGN"))).limit(1);
      wasTableQr = Boolean(priorAssignment);
    }

    if (!wasTableQr) {
      if (qr.status === "LOCKED" || qr.status === "RETIRED" || qr.targetType === "UNASSIGNED") return unavailable(request);
      return Response.redirect(qrCustomerRedirectUrl(request, qr.targetType === "WAITING" ? "/qrorder/wait" : "/qrorder/guest"));
    }
    loggedQrCodeId = qrCodeId;

    if (qr.status === "RETIRED") {
      await recordQrAccess(qrCodeId, "QR_ACCESS_FAILED", "RETIRED_QR");
      return unavailable(request);
    }
    if (qr.status !== "IN_USE") {
      await recordQrAccess(qrCodeId, "QR_ACCESS_FAILED", "QR_DISABLED");
      return unavailable(request);
    }
    if (!qr.tableId) {
      await recordQrAccess(qrCodeId, "QR_ACCESS_FAILED", "TABLE_NOT_LINKED");
      return unavailable(request);
    }
    const qrTableId = Number(qr.tableId);
    const activeVisits = await db.select({ sessionId: tableSessions.sessionId }).from(tableSessions)
      .where(and(eq(tableSessions.tableId, qrTableId), eq(tableSessions.sessionKind, "DINE_IN"), eq(tableSessions.status, "OPEN")))
      .limit(2);
    let currentVisitHasOrders = activeVisits.length > 1;
    if (activeVisits.length === 1) {
      const [currentVisitOrder] = await db.select({ orderId: orders.orderId }).from(orders)
        .where(and(eq(orders.sessionId, activeVisits[0].sessionId), eq(orders.orderType, "POS"))).limit(1);
      currentVisitHasOrders = Boolean(currentVisitOrder);
    }
    const entryDestination = currentVisitHasOrders ? "/qrorder" : "/qrorder/order";

    const currentToken = await getQrAccessTokenFromCookies();
    let reusableQrSessionId: number | null = null;
    if (currentToken) {
      const current = await resolveQrOrderSession(currentToken);
      // Only reuse a session for the scanned table. A different table gets a fresh, unbound session below.
      if (current?.tableId === qrTableId) {
        if (current.canViewOrders) {
          await recordQrAccess(qrCodeId, "QR_ACCESS_REUSED");
          authEventRecorded = true;
          return Response.redirect(qrCustomerRedirectUrl(request, "/qrorder"));
        }
        reusableQrSessionId = current.qrSessionId;
      }
    }

    const token = createQrAccessToken();
    let result: { response: Response } | { failure: QrAccessFailureType } | null;
    try {
      result = await db.transaction(async tx => {
        const [lockedQr] = await tx.select({ qrCodeId: qrCodes.qrCodeId, status: qrCodes.status, targetType: qrCodes.targetType })
          .from(qrCodes).where(and(eq(qrCodes.qrCodeId, qrCodeId), eq(qrCodes.identifier, identifier))).for("update").limit(1);
        if (!lockedQr || lockedQr.status !== "IN_USE" || lockedQr.targetType !== "TABLE_ORDER") return { failure: "QR_DISABLED" as const };
        const [table] = await tx.select({ tableId: diningTables.tableId, isActive: diningTables.isActive })
          .from(diningTables).where(and(eq(diningTables.tableId, qrTableId), eq(diningTables.isActive, 1))).for("update").limit(1);
        if (!table) return { failure: "TABLE_INACTIVE" as const };
        const [link] = await tx.select({ qrCodeId: qrTableLinks.qrCodeId }).from(qrTableLinks)
          .where(and(eq(qrTableLinks.qrCodeId, qrCodeId), eq(qrTableLinks.tableId, qrTableId))).limit(1);
        if (!link) return { failure: "QR_LINK_CHANGED" as const };
        if (reusableQrSessionId !== null) {
          const [reusable] = await tx.select({ qrSessionId: qrSessions.qrSessionId }).from(qrSessions)
            .where(and(eq(qrSessions.qrSessionId, reusableQrSessionId), eq(qrSessions.tableId, qrTableId), eq(qrSessions.status, "ACTIVE"), isNull(qrSessions.sessionId)))
            .for("update").limit(1);
          if (!reusable) return { failure: "SESSION_ISSUE_FAILED" as const };
          const [ownOrder] = await tx.select({ qrOrderId: qrOrders.qrOrderId }).from(qrOrders)
            .where(eq(qrOrders.qrSessionId, reusableQrSessionId)).limit(1);
          const destination = ownOrder || currentVisitHasOrders ? "/qrorder" : "/qrorder/order";
          return { response: Response.redirect(qrCustomerRedirectUrl(request, destination)) };
        }
        await tx.insert(qrSessions).values({ sessionId: null, tableId: table.tableId,
          tokenHash: hashQrToken(token), languageCode: "ko", status: "ACTIVE", lastActiveAt: new Date() });
        return { response: qrSessionRedirectResponse(request, entryDestination, token) };
      });
    } catch (error) {
      logQrAccessError("SESSION_ISSUE", qrCodeId, error);
      await recordQrAccess(qrCodeId, "QR_ACCESS_FAILED", "SESSION_ISSUE_FAILED");
      authEventRecorded = true;
      return serviceUnavailable(request);
    }

    if (!result || "failure" in result) {
      await recordQrAccess(qrCodeId, "QR_ACCESS_FAILED", result && "failure" in result ? result.failure : "SESSION_ISSUE_FAILED");
      authEventRecorded = true;
      return unavailable(request);
    }

    await recordQrAccess(qrCodeId, reusableQrSessionId === null ? "QR_ACCESS_ISSUED" : "QR_ACCESS_REUSED");
    authEventRecorded = true;
    return result.response;
  } catch (error) {
    logQrAccessError("AUTH_OR_DATABASE", loggedQrCodeId, error);
    if (loggedQrCodeId !== null && !authEventRecorded) await recordQrAccess(loggedQrCodeId, "QR_ACCESS_FAILED", "AUTH_ERROR");
    return serviceUnavailable(request);
  }
}
