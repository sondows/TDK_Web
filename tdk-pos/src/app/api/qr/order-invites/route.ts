import { randomBytes, createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { diningTables, qrSessionInvites, qrSessions, tableSessions } from "@/db/schema";
import { resolveQrOrderRequest } from "@/lib/qr-order-auth";
import { isSameOriginQrRequest } from "@/lib/qr-visit-session";
import { qrTableSessionExpiresAtSql } from "@/lib/qr-session-expiry-policy";
import { getQrOrderInviteFailure } from "@/lib/qr-order-invite-failure";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginQrRequest(request)) return Response.json({ success: false }, { status: 403 });
  const member = await resolveQrOrderRequest(request);
  if (!member) return Response.json({ success: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (member.sessionId === null) return Response.json({ success: false, message: "첫 주문이 POS에서 승인된 뒤 일행 초대를 만들 수 있습니다." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  const memberSessionId = member.sessionId;
  try {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const result = await db.transaction(async tx => {
      const [session] = await tx.select({ sessionId: tableSessions.sessionId, capacity: diningTables.capacity })
        .from(tableSessions).innerJoin(diningTables, eq(diningTables.tableId, tableSessions.tableId))
        .where(and(eq(tableSessions.sessionId, memberSessionId), eq(tableSessions.status, "OPEN"))).for("update").limit(1);
      if (!session) return { kind: "CLOSED" as const };
      const sessionExpiry = qrTableSessionExpiresAtSql(memberSessionId);
      const [expiry] = await tx.select({ remainingSeconds: sql<number>`TIMESTAMPDIFF(SECOND, CURRENT_TIMESTAMP, ${sessionExpiry})` })
        .from(tableSessions).where(eq(tableSessions.sessionId, memberSessionId)).limit(1);
      if (!expiry || Number(expiry.remainingSeconds) <= 0) return { kind: "EXPIRED" as const };
      const [active] = await tx.select({ count: sql<number>`COUNT(*)` }).from(qrSessions)
        .where(and(eq(qrSessions.sessionId, memberSessionId), eq(qrSessions.status, "ACTIVE")));
      const cap = Math.max(1, Number(session.capacity) || 8);
      if (Number(active?.count ?? 0) >= cap) return { kind: "FULL" as const };
      await tx.insert(qrSessionInvites).values({ sessionId: memberSessionId, createdByQrSessionId: member.qrSessionId,
        tokenHash, expiresAt: sessionExpiry });
      return { kind: "CREATED" as const, remainingSeconds: Number(expiry.remainingSeconds) };
    });
    if (result.kind !== "CREATED") return Response.json({ success: false, ...getQrOrderInviteFailure(result.kind) }, { status: 409 });
    const expiresAt = new Date(Date.now() + result.remainingSeconds * 1000).toISOString();
    return Response.json({ success: true, url: new URL(`/q/join/${token}`, request.url).toString(), expiresAt }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "초대 링크를 만들지 못했습니다." }, { status: 503 });
  }
}
