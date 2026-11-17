import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { diningTables, qrCodes, qrOrders, qrSessions, qrTableLinks, tableSessions } from "@/db/schema";
import { createQrAccessToken, getQrAccessTokenFromCookies, hashQrToken, qrSessionCookieAttributes, QR_ORDER_ACCESS_MAX_AGE_SECONDS, resolveQrOrderSession } from "@/lib/qr-order-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ identifier: string }> }) {
  const identifier = (await params).identifier;
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{16}$/.test(identifier)) return Response.redirect(new URL("/qrorder/unavailable", request.url));
  try {
    const [qr] = await db.select({ qrCodeId: qrCodes.qrCodeId, targetType: qrCodes.targetType, status: qrCodes.status, tableId: qrTableLinks.tableId })
      .from(qrCodes).leftJoin(qrTableLinks, eq(qrTableLinks.qrCodeId, qrCodes.qrCodeId)).where(eq(qrCodes.identifier, identifier)).limit(1);
    if (!qr || qr.status === "LOCKED" || qr.status === "RETIRED" || qr.targetType === "UNASSIGNED") return Response.redirect(new URL("/qrorder/unavailable", request.url));
    if (qr.targetType !== "TABLE_ORDER" || !qr.tableId || qr.status !== "IN_USE") return Response.redirect(new URL(qr.targetType === "WAITING" ? "/qrorder/wait" : "/qrorder/guest", request.url));
    const qrTableId = Number(qr.tableId);

    const currentToken = await getQrAccessTokenFromCookies();
    if (currentToken) {
      const current = await resolveQrOrderSession(currentToken);
      if (current?.tableId === qrTableId) {
        if (current.sessionId !== null) return Response.redirect(new URL("/qrorder", request.url));
        const [ownOrder] = await db.select({ qrOrderId: qrOrders.qrOrderId }).from(qrOrders)
          .where(eq(qrOrders.qrSessionId, current.qrSessionId)).limit(1);
        if (ownOrder) return Response.redirect(new URL("/qrorder", request.url));
        const [occupied] = await db.select({ sessionId: tableSessions.sessionId }).from(tableSessions)
          .where(and(eq(tableSessions.tableId, qrTableId), eq(tableSessions.sessionKind, "DINE_IN"), eq(tableSessions.status, "OPEN"))).limit(1);
        return Response.redirect(new URL(occupied ? "/qrorder/join-required" : "/qrorder/order", request.url));
      }
      if (current) return Response.redirect(new URL("/qrorder/unavailable", request.url));
    }

    const token = createQrAccessToken();
    const result = await db.transaction(async tx => {
      const [lockedQr] = await tx.select({ qrCodeId: qrCodes.qrCodeId, status: qrCodes.status, targetType: qrCodes.targetType })
        .from(qrCodes).where(and(eq(qrCodes.qrCodeId, qr.qrCodeId), eq(qrCodes.identifier, identifier))).for("update").limit(1);
      if (!lockedQr || lockedQr.status !== "IN_USE" || lockedQr.targetType !== "TABLE_ORDER") return null;
      const [table] = await tx.select({ tableId: diningTables.tableId, isActive: diningTables.isActive })
        .from(diningTables).where(and(eq(diningTables.tableId, qrTableId), eq(diningTables.isActive, 1))).for("update").limit(1);
      if (!table) return null;
      const [link] = await tx.select({ qrCodeId: qrTableLinks.qrCodeId }).from(qrTableLinks)
        .where(and(eq(qrTableLinks.qrCodeId, qr.qrCodeId), eq(qrTableLinks.tableId, qrTableId))).limit(1);
      if (!link) return null;
      const openSessions = await tx.select({ sessionId: tableSessions.sessionId }).from(tableSessions)
        .where(and(eq(tableSessions.tableId, table.tableId), eq(tableSessions.sessionKind, "DINE_IN"), eq(tableSessions.status, "OPEN"))).for("update").limit(1);
      await tx.insert(qrSessions).values({ sessionId: null, tableId: table.tableId, tokenHash: hashQrToken(token), languageCode: "ko", status: "ACTIVE", lastActiveAt: new Date() });
      return { inUse: openSessions.length > 0 };
    });
    if (!result) return Response.redirect(new URL("/qrorder/unavailable", request.url));
    const destination = result.inUse ? "/qrorder/join-required" : "/qrorder/order";
    const response = Response.redirect(new URL(destination, request.url));
    response.headers.append("Set-Cookie", `tdkon_qr_session=${encodeURIComponent(token)}; ${qrSessionCookieAttributes(request, QR_ORDER_ACCESS_MAX_AGE_SECONDS)}`);
    return response;
  } catch {
    return Response.redirect(new URL("/qrorder/unavailable", request.url));
  }
}
