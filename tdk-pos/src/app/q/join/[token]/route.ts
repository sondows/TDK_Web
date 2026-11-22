import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { diningTables, qrCodes, qrSessionInvites, qrSessions, qrTableLinks, tableSessions } from "@/db/schema";
import { createQrAccessToken, hashQrToken, qrSessionRedirectResponse, QR_ORDER_ACCESS_MAX_AGE_SECONDS, resolveQrOrderRequest } from "@/lib/qr-order-auth";
import { qrSessionCookieMaxAgeSeconds, qrTableSessionExpiresAtSql } from "@/lib/qr-session-expiry-policy";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return Response.redirect(new URL("/qrorder/invite-invalid", request.url));
  const now = new Date();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  try {
    const current = await resolveQrOrderRequest(request);
    const result = await db.transaction(async tx => {
      const [invite] = await tx.select({ inviteId: qrSessionInvites.inviteId, sessionId: qrSessionInvites.sessionId,
        remainingSeconds: sql<number>`TIMESTAMPDIFF(SECOND, CURRENT_TIMESTAMP, ${qrSessionInvites.expiresAt})`,
        redeemedAt: qrSessionInvites.redeemedAt, revokedAt: qrSessionInvites.revokedAt })
        .from(qrSessionInvites).where(eq(qrSessionInvites.tokenHash, tokenHash)).for("update").limit(1);
      if (!invite || invite.revokedAt || Number(invite.remainingSeconds) <= 0) return { kind: "INVALID" as const };
      const [sessionSnapshot] = await tx.select({ tableId: tableSessions.tableId }).from(tableSessions)
        .where(and(eq(tableSessions.sessionId, invite.sessionId), eq(tableSessions.status, "OPEN"))).limit(1);
      if (!sessionSnapshot?.tableId) return { kind: "INVALID" as const };
      await tx.select({ tableId: diningTables.tableId }).from(diningTables)
        .where(and(eq(diningTables.tableId, sessionSnapshot.tableId), eq(diningTables.isActive, 1))).for("update").limit(1);
      const [session] = await tx.select({ sessionId: tableSessions.sessionId, tableId: diningTables.tableId, capacity: diningTables.capacity })
        .from(tableSessions).innerJoin(diningTables, eq(diningTables.tableId, tableSessions.tableId))
        .where(and(eq(tableSessions.sessionId, invite.sessionId), eq(tableSessions.status, "OPEN"), eq(diningTables.isActive, 1))).for("update").limit(1);
      if (!session || Number(session.tableId) !== Number(sessionSnapshot.tableId)) return { kind: "INVALID" as const };
      const [currentQr] = await tx.select({ qrCodeId: qrCodes.qrCodeId }).from(qrTableLinks)
        .innerJoin(qrCodes, eq(qrCodes.qrCodeId, qrTableLinks.qrCodeId))
        .where(and(eq(qrTableLinks.tableId, session.tableId), eq(qrCodes.targetType, "TABLE_ORDER"), eq(qrCodes.status, "IN_USE")))
        .for("update").limit(1);
      if (!currentQr) return { kind: "INVALID" as const };
      const sessionExpiry = qrTableSessionExpiresAtSql(invite.sessionId);
      const [rootExpiry] = await tx.select({ remainingSeconds: sql<number>`TIMESTAMPDIFF(SECOND, CURRENT_TIMESTAMP, ${sessionExpiry})` })
        .from(tableSessions).where(eq(tableSessions.sessionId, invite.sessionId)).limit(1);
      if (!rootExpiry) return { kind: "INVALID" as const };
      const effectiveRemainingSeconds = Math.min(Number(invite.remainingSeconds), Number(rootExpiry.remainingSeconds));
      const cookieMaxAgeSeconds = qrSessionCookieMaxAgeSeconds(effectiveRemainingSeconds, QR_ORDER_ACCESS_MAX_AGE_SECONDS);
      if (cookieMaxAgeSeconds <= 0) return { kind: "INVALID" as const };
      if (current?.sessionId === Number(session.sessionId)) return { kind: "EXISTING" as const };
      const [active] = await tx.select({ count: sql<number>`COUNT(*)` }).from(qrSessions)
        .where(and(eq(qrSessions.sessionId, invite.sessionId), eq(qrSessions.status, "ACTIVE")));
      const cap = Math.max(1, Number(session.capacity) || 8);
      if (Number(active?.count ?? 0) >= cap) return { kind: "FULL" as const };
      if (current?.isTest) {
        if (current.sessionId !== null && current.sessionId !== Number(session.sessionId)) return { kind: "INVALID" as const };
        const updated = await tx.update(qrSessions).set({ sessionId: invite.sessionId, tableId: session.tableId, lastActiveAt: now })
          .where(and(eq(qrSessions.qrSessionId, current.qrSessionId), eq(qrSessions.status, "ACTIVE"), isNull(qrSessions.sessionId)));
        if (updated[0].affectedRows !== 1) return { kind: "INVALID" as const };
        if (!invite.redeemedAt) await tx.update(qrSessionInvites).set({ redeemedAt: now }).where(and(eq(qrSessionInvites.inviteId, invite.inviteId), isNull(qrSessionInvites.redeemedAt)));
        return { kind: "JOINED_TEST" as const };
      }
      const accessToken = createQrAccessToken();
      if (current?.sessionId === null) await tx.update(qrSessions).set({ status: "CLOSED", closedAt: now })
        .where(and(eq(qrSessions.qrSessionId, current.qrSessionId), eq(qrSessions.status, "ACTIVE")));
      await tx.insert(qrSessions).values({ sessionId: invite.sessionId, tableId: session.tableId, tokenHash: hashQrToken(accessToken), languageCode: "ko", status: "ACTIVE", lastActiveAt: now });
      if (!invite.redeemedAt) await tx.update(qrSessionInvites).set({ redeemedAt: now }).where(and(eq(qrSessionInvites.inviteId, invite.inviteId), isNull(qrSessionInvites.redeemedAt)));
      return { kind: "JOINED" as const, response: qrSessionRedirectResponse(request, "/qrorder", accessToken, cookieMaxAgeSeconds) };
    });
    if (result.kind === "JOINED_TEST") return Response.redirect(new URL("/qrorder", request.url));
    if (result.kind !== "JOINED") return Response.redirect(new URL(result.kind === "EXISTING" ? "/qrorder" : result.kind === "FULL" ? "/qrorder/invite-full" : "/qrorder/invite-invalid", request.url));
    return result.response;
  } catch {
    return Response.redirect(new URL("/qrorder/invite-invalid", request.url));
  }
}
