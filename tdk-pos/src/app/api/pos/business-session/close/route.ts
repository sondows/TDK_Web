import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessSessionMutex, businessSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { lockBusinessMutex } from "@/lib/business-session";
import { closingPreview } from "@/lib/business-closing";

class ClosingError extends Error { constructor(message: string, readonly status = 409) { super(message); } }
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function actor() {
  const staff = await getCurrentStaff();
  if (!staff && await getPosLoginMode() !== "SHARED") throw new ClosingError("로그인이 필요합니다.", 401);
  return staff?.staffId ?? null;
}

async function preview() {
  return db.transaction(async tx => {
    await lockBusinessMutex(tx);
    const [open] = await tx.select({ id: businessSessions.businessSessionId }).from(businessSessions)
      .where(eq(businessSessions.openGuard, 1)).for("update").limit(1);
    return open ? closingPreview(tx, open.id) : null;
  });
}

export async function GET() {
  try {
    await actor();
    const current = await preview();
    return response({ success: true, preview: current });
  } catch (error) {
    if (error instanceof ClosingError) return response({ success: false, message: error.message }, error.status);
    console.error("Business closing preview failed", error);
    return response({ success: false, message: "영업마감 정보를 불러오지 못했습니다." }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const staffId = await actor();
    const body = await request.json().catch(() => null) as { businessSessionId?: unknown; actualCash?: unknown } | null;
    const requestedId = Number(body?.businessSessionId);
    if (!Number.isSafeInteger(requestedId) || requestedId <= 0) throw new ClosingError("영업세션을 확인해 주세요.", 400);
    const saved = await db.transaction(async tx => {
      await lockBusinessMutex(tx);
      const [open] = await tx.select().from(businessSessions).where(eq(businessSessions.businessSessionId, requestedId)).for("update").limit(1);
      if (!open || open.status !== "OPEN" || open.openGuard !== 1) throw new ClosingError("이미 영업마감된 영업입니다.");
      const current = await closingPreview(tx, requestedId);
      if (!current) throw new ClosingError("이미 영업마감된 영업입니다.");
      if (current.blockers.length) throw new ClosingError("완료되지 않은 주문 또는 결제가 있습니다.");
      const actualCash = body?.actualCash;
      if (current.openingCashEnabled && (typeof actualCash !== "number" || !Number.isSafeInteger(actualCash) || actualCash < 0 || actualCash > 999999999999))
        throw new ClosingError("실제 현금을 0원 이상의 정수로 입력해 주세요.", 400);
      const difference = current.openingCashEnabled ? (actualCash as number) - current.expectedCash! : null;
      const [clock] = await tx.select({ local: sql<string>`DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s')` }).from(businessSessionMutex).limit(1);
      const snapshot = { ...current, closedAt: `${clock.local.replace(" ", "T")}+09:00`, blockers: [], actualCash: current.openingCashEnabled ? actualCash : null, cashDifference: difference };
      const [updated] = await tx.update(businessSessions).set({
        status: "CLOSED", openGuard: null, closedAt: sql`${clock.local}`, closedByStaffId: staffId,
        closingSnapshot: JSON.stringify(snapshot),
        expectedCash: current.expectedCash?.toFixed(2) ?? null,
        actualCash: current.openingCashEnabled ? (actualCash as number).toFixed(2) : null,
        cashDifference: difference?.toFixed(2) ?? null,
      }).where(and(eq(businessSessions.businessSessionId, requestedId), eq(businessSessions.status, "OPEN")));
      if (updated.affectedRows !== 1) throw new ClosingError("이미 영업마감된 영업입니다.");
      return snapshot;
    });
    return response({ success: true, closing: saved });
  } catch (error) {
    if (error instanceof ClosingError) return response({ success: false, message: error.message }, error.status);
    console.error("Business closing failed", error);
    return response({ success: false, message: "영업마감에 실패했습니다." }, 500);
  }
}
