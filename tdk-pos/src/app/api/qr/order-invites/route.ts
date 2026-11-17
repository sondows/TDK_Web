import { randomBytes, createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { diningTables, qrSessionInvites, qrSessions, tableSessions } from "@/db/schema";
import { resolveQrOrderRequest } from "@/lib/qr-order-auth";
import { isSameOriginQrRequest } from "@/lib/qr-visit-session";

export const dynamic = "force-dynamic";
const INVITE_TTL_MS = 30 * 60 * 1000;

export async function POST(request: Request) {
  if (!isSameOriginQrRequest(request)) return Response.json({ success: false }, { status: 403 });
  const member = await resolveQrOrderRequest(request);
  if (!member) return Response.json({ success: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (member.sessionId === null) return Response.json({ success: false, message: "첫 주문이 POS에서 승인된 뒤 일행 초대를 만들 수 있습니다." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  const memberSessionId = member.sessionId;
  const now = new Date();
  try {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const result = await db.transaction(async tx => {
      const [session] = await tx.select({ sessionId: tableSessions.sessionId, capacity: diningTables.capacity })
        .from(tableSessions).innerJoin(diningTables, eq(diningTables.tableId, tableSessions.tableId))
        .where(and(eq(tableSessions.sessionId, memberSessionId), eq(tableSessions.status, "OPEN"))).for("update").limit(1);
      if (!session) return false;
      const [active] = await tx.select({ count: sql<number>`COUNT(*)` }).from(qrSessions)
        .where(and(eq(qrSessions.sessionId, memberSessionId), eq(qrSessions.status, "ACTIVE")));
      const cap = Math.max(1, Number(session.capacity) || 8);
      if (Number(active?.count ?? 0) >= cap) return false;
      await tx.insert(qrSessionInvites).values({ sessionId: memberSessionId, createdByQrSessionId: member.qrSessionId,
        tokenHash, expiresAt: new Date(now.getTime() + INVITE_TTL_MS) });
      return true;
    });
    if (!result) return Response.json({ success: false, message: "이 테이블의 참여 인원 한도에 도달했습니다." }, { status: 409 });
    return Response.json({ success: true, url: new URL(`/q/join/${token}`, request.url).toString(), expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "초대 링크를 만들지 못했습니다." }, { status: 503 });
  }
}
