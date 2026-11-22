import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, diningTables, qrCodes, qrOrders, qrSessions, qrTableLinks, tableSessions } from "@/db/schema";
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

    const currentToken = await getQrAccessTokenFromCookies();
    if (currentToken) {
      const current = await resolveQrOrderSession(currentToken);
      if (current?.tableId === qrTableId) {
        await recordQrAccess(qrCodeId, "QR_ACCESS_REUSED");
        authEventRecorded = true;
        if (current.sessionId !== null) return Response.redirect(qrCustomerRedirectUrl(request, "/qrorder"));
        const [ownOrder] = await db.select({ qrOrderId: qrOrders.qrOrderId }).from(qrOrders)
          .where(eq(qrOrders.qrSessionId, current.qrSessionId)).limit(1);
        if (ownOrder) return Response.redirect(qrCustomerRedirectUrl(request, "/qrorder"));
        const [occupied] = await db.select({ sessionId: tableSessions.sessionId }).from(tableSessions)
          .where(and(eq(tableSessions.tableId, qrTableId), eq(tableSessions.sessionKind, "DINE_IN"), eq(tableSessions.status, "OPEN"))).limit(1);
        return Response.redirect(qrCustomerRedirectUrl(request, occupied ? "/qrorder/join-required" : "/qrorder/order"));
      }
      if (current) {
        await recordQrAccess(qrCodeId, "QR_ACCESS_FAILED", "SESSION_TABLE_MISMATCH");
        authEventRecorded = true;
        return unavailable(request);
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
        const openSessions = await tx.select({ sessionId: tableSessions.sessionId }).from(tableSessions)
          .where(and(eq(tableSessions.tableId, table.tableId), eq(tableSessions.sessionKind, "DINE_IN"), eq(tableSessions.status, "OPEN"))).for("update").limit(1);
        await tx.insert(qrSessions).values({ sessionId: null, tableId: table.tableId, tokenHash: hashQrToken(token), languageCode: "ko", status: "ACTIVE", lastActiveAt: new Date() });
        return { response: qrSessionRedirectResponse(request, openSessions.length > 0 ? "/qrorder/join-required" : "/qrorder/order", token) };
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

    await recordQrAccess(qrCodeId, "QR_ACCESS_ISSUED");
    authEventRecorded = true;
    return result.response;
  } catch (error) {
    logQrAccessError("AUTH_OR_DATABASE", loggedQrCodeId, error);
    if (loggedQrCodeId !== null && !authEventRecorded) await recordQrAccess(loggedQrCodeId, "QR_ACCESS_FAILED", "AUTH_ERROR");
    return serviceUnavailable(request);
  }
}
