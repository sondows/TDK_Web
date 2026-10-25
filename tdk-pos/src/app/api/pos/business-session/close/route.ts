import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessSessionMutex, dailyClosingSnapshots } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { lockBusinessMutex } from "@/lib/business-session";
import { dailyClosingPreview } from "@/lib/daily-closing";
import { databaseToday } from "@/lib/daily-opening-cash";
import { cashOpeningFundTotal, parseCashOpeningFund } from "@/lib/cash-opening-fund";
import { sameDailyClosingResult } from "@/lib/daily-closing-idempotency";

class ClosingError extends Error { constructor(message: string, readonly status = 409) { super(message); } }
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function actor() {
  const staff = await getCurrentStaff();
  if (!staff && await getPosLoginMode() !== "SHARED") throw new ClosingError("로그인이 필요합니다.", 401);
  return staff?.staffId ?? null;
}

async function preview() {
  return db.transaction(async tx => {
    const today = await databaseToday(tx);
    return dailyClosingPreview(tx, today);
  });
}

export async function GET(request: Request) {
  let requestKey: string | null = null;
  try {
    await actor();
    requestKey = new URL(request.url).searchParams.get("requestKey");
    if (requestKey !== null) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey))
        throw new ClosingError("마감 요청을 확인해 주세요.", 400);
      const [saved] = await db.select({ snapshot: dailyClosingSnapshots.snapshot }).from(dailyClosingSnapshots)
        .where(eq(dailyClosingSnapshots.requestKey, requestKey)).limit(1);
      return response({ success: true, closing: saved ? JSON.parse(saved.snapshot) : null });
    }
    const current = await preview();
    return response({ success: true, preview: current });
  } catch (error) {
    if (error instanceof ClosingError) return response({ success: false, message: error.message }, error.status);
    console.error("Business closing lookup failed", { requestKey }, error);
    return response({ success: false, message: "영업마감 정보를 불러오지 못했습니다." }, 500);
  }
}

export async function POST(request: Request) {
  let requestKey: string | null = null;
  let stage = "authentication";
  try {
    const staffId = await actor();
    stage = "request validation";
    const body = await request.json().catch(() => null) as { businessDate?: unknown; previousClosingCount?: unknown; requestKey?: unknown; actualCash?: unknown; actualCashFund?: unknown } | null;
    if (typeof body?.businessDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.businessDate))
      throw new ClosingError("정산 날짜를 확인해 주세요.", 400);
    if (typeof body.requestKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestKey))
      throw new ClosingError("마감 요청을 확인해 주세요.", 400);
    requestKey = body.requestKey;
    if (!Number.isSafeInteger(body.previousClosingCount) || Number(body.previousClosingCount) < 0)
      throw new ClosingError("마감 정보를 다시 불러와 주세요.", 400);
    stage = "closing transaction";
    const saved = await db.transaction(async tx => {
      await lockBusinessMutex(tx);
      const [prior] = await tx.select({ snapshot: dailyClosingSnapshots.snapshot }).from(dailyClosingSnapshots)
        .where(eq(dailyClosingSnapshots.requestKey, body.requestKey as string)).limit(1);
      if (prior) return JSON.parse(prior.snapshot);
      const today = await databaseToday(tx);
      if (body.businessDate !== today) throw new ClosingError("날짜가 변경되었습니다. 마감 정보를 다시 확인해 주세요.");
      const current = await dailyClosingPreview(tx, today);
      if (current.blockers.length) {
        console.warn("Business closing blocked", { requestKey, blockers: current.blockers.map(row => ({ id: row.sessionId, reason: row.reason })) });
        throw new ClosingError("완료되지 않은 주문 또는 결제가 있습니다.");
      }
      if (current.openingCashEnabled && current.expectedCash === null) throw new ClosingError("오늘의 시작 준비금이 등록되지 않았습니다.");
      const actualCash = body?.actualCash;
      if (current.openingCashEnabled && (typeof actualCash !== "number" || !Number.isSafeInteger(actualCash) || actualCash < 0 || actualCash > 999999999999))
        throw new ClosingError("실제 현금을 0원 이상의 정수로 입력해 주세요.", 400);
      const actualCashFund = current.openingCashEnabled ? parseCashOpeningFund(body?.actualCashFund) : null;
      if (current.openingCashEnabled && (!actualCashFund || cashOpeningFundTotal(actualCashFund) !== actualCash))
        throw new ClosingError("시재 확인에서 권종별 실제 현금을 입력해 주세요.", 400);
      const difference = current.openingCashEnabled ? (actualCash as number) - current.expectedCash! : null;
      const [last] = await tx.select({ revision: dailyClosingSnapshots.revision, snapshot: dailyClosingSnapshots.snapshot }).from(dailyClosingSnapshots)
        .where(eq(dailyClosingSnapshots.salesDate, today)).orderBy(desc(dailyClosingSnapshots.revision)).limit(1);
      if ((last?.revision ?? 0) !== body.previousClosingCount) {
        if (!last) throw new ClosingError("마감 정보가 변경되었습니다. 다시 확인해 주세요.");
        const priorSnapshot = JSON.parse(last.snapshot) as Record<string, unknown>;
        if (sameDailyClosingResult(priorSnapshot, current, current.openingCashEnabled ? actualCash as number : null, actualCashFund))
          return priorSnapshot;
        throw new ClosingError("다른 POS에서 마감 정보가 변경되었습니다. 다시 확인해 주세요.");
      }
      const revision = (last?.revision ?? 0) + 1;
      const [clock] = await tx.select({ local: sql<string>`DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s')` }).from(businessSessionMutex).limit(1);
      const snapshot = { ...current, revision, closedAt: `${clock.local.replace(" ", "T")}+09:00`, blockers: [], actualCash: current.openingCashEnabled ? actualCash : null, actualCashFund, cashDifference: difference };
      await tx.insert(dailyClosingSnapshots).values({ salesDate: today, revision, requestKey: body.requestKey as string, snapshot: JSON.stringify(snapshot), closedByStaffId: staffId });
      return snapshot;
    });
    stage = "response serialization";
    return response({ success: true, closing: saved });
  } catch (error) {
    if (error instanceof ClosingError) {
      console.warn("Business closing rejected", { requestKey, stage, status: error.status, reason: error.message });
      return response({ success: false, message: error.message }, error.status);
    }
    console.error("Business closing failed", { requestKey, stage }, error);
    return response({ success: false, message: "영업마감에 실패했습니다." }, 500);
  }
}
