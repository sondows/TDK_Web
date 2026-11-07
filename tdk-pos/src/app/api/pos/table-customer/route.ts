import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { customers, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";

export async function POST(request: Request) {
  if (!await getCurrentStaff() && await getPosLoginMode() !== "SHARED") {
    return Response.json({ success: false }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { sessionIds?: unknown; customerId?: unknown } | null;
  const sessionIds = Array.isArray(body?.sessionIds)
    ? [...new Set(body.sessionIds.map(Number))]
    : [];
  const customerId = body?.customerId === null ? null : Number(body?.customerId);
  if (!sessionIds.length || sessionIds.some(id => !Number.isSafeInteger(id) || id <= 0)
    || (customerId !== null && (!Number.isSafeInteger(customerId) || customerId <= 0))) {
    return Response.json({ success: false, message: "고객 연결 정보가 올바르지 않습니다." }, { status: 400 });
  }

  try {
    await db.transaction(async tx => {
      const sessions = await tx.select({ sessionId: tableSessions.sessionId }).from(tableSessions)
        .where(and(inArray(tableSessions.sessionId, sessionIds), eq(tableSessions.status, "OPEN"),
          eq(tableSessions.sessionKind, "DINE_IN")));
      if (sessions.length !== sessionIds.length) throw new Error("SESSION_NOT_AVAILABLE");

      if (customerId !== null) {
        const [customer] = await tx.select({ customerId: customers.customerId }).from(customers)
          .where(and(eq(customers.customerId, customerId), eq(customers.isActive, 1))).limit(1);
        if (!customer) throw new Error("CUSTOMER_NOT_AVAILABLE");
      }

      await tx.update(tableSessions).set({ pickupCustomerId: customerId, pickupName: customerId === null ? "" : null })
        .where(and(inArray(tableSessions.sessionId, sessionIds), eq(tableSessions.status, "OPEN"),
          eq(tableSessions.sessionKind, "DINE_IN")));
    });
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "SESSION_NOT_AVAILABLE") {
      return Response.json({ success: false, message: "사용 중인 테이블을 찾을 수 없습니다." }, { status: 409 });
    }
    if (code === "CUSTOMER_NOT_AVAILABLE") {
      return Response.json({ success: false, message: "고객 정보를 찾을 수 없습니다." }, { status: 404 });
    }
    console.error("POS table customer update failed", { code: (error as { code?: string }).code });
    return Response.json({ success: false }, { status: 503 });
  }
}
