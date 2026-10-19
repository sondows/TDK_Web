import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, staff } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { lockBusinessMutex } from "@/lib/business-session";
import { cashOpeningFundTotal, parseCashOpeningFund } from "@/lib/cash-opening-fund";
import { dailyClosingPreview } from "@/lib/daily-closing";
import { databaseToday } from "@/lib/daily-opening-cash";
import { getPosLoginMode } from "@/lib/pos-login-mode";

const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function actorId() {
  const current = await getCurrentStaff();
  if (current) return current.staffId;
  if (await getPosLoginMode() !== "SHARED") return null;
  const [shared] = await db.select({ staffId: staff.staffId }).from(staff)
    .where(and(eq(staff.staffCode, "000"), eq(staff.isActive, 1))).limit(1);
  return shared?.staffId ?? null;
}

function unavailableMessage(preview: Awaited<ReturnType<typeof dailyClosingPreview>>) {
  return preview.openingCashEnabled
    ? "오늘 영업준비금이 등록되지 않아 예상 시재를 계산할 수 없습니다."
    : "시재등록 설정이 꺼져 있어 예상 시재를 계산할 수 없습니다.";
}

export async function GET() {
  try {
    if (!await actorId()) return response({ success: false, message: "로그인이 필요합니다." }, 401);
    const preview = await db.transaction(async tx => dailyClosingPreview(tx, await databaseToday(tx)));
    return response({ success: true, businessDate: preview.businessDate, expectedCash: preview.expectedCash,
      message: preview.expectedCash === null ? unavailableMessage(preview) : null });
  } catch (error) {
    console.error("Cash check preview failed", error);
    return response({ success: false, message: "예상 시재를 불러오지 못했습니다." }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const staffId = await actorId();
    if (!staffId) return response({ success: false, message: "로그인이 필요합니다." }, 401);
    const body = await request.json().catch(() => null);
    const fund = parseCashOpeningFund(body);
    if (!fund || typeof body?.businessDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.businessDate)
      || !Number.isSafeInteger(body.expectedCash)
      || typeof body.requestKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestKey))
      return response({ success: false, message: "시재 확인 정보를 다시 확인해 주세요." }, 400);
    const actualCash = cashOpeningFundTotal(fund);
    if (!Number.isSafeInteger(actualCash)) return response({ success: false, message: "실제 시재 금액이 너무 큽니다." }, 400);

    const saved = await db.transaction(async tx => {
      await lockBusinessMutex(tx);
      const [prior] = await tx.select({ description: auditLogs.description }).from(auditLogs)
        .where(and(eq(auditLogs.entityType, "CASH_CHECK"),
          sql`JSON_UNQUOTE(JSON_EXTRACT(${auditLogs.description}, '$.requestKey')) = ${body.requestKey}`)).limit(1);
      if (prior?.description) return JSON.parse(prior.description) as { businessDate: string; expectedCash: number; actualCash: number; difference: number };

      const today = await databaseToday(tx);
      if (body.businessDate !== today) return null;
      const preview = await dailyClosingPreview(tx, today);
      if (preview.expectedCash === null || preview.expectedCash !== body.expectedCash) return null;
      const check = { requestKey: body.requestKey, businessDate: today, expectedCash: preview.expectedCash,
        actualCash, difference: actualCash - preview.expectedCash, fund };
      await tx.insert(auditLogs).values({ staffId, actionType: "CHECK", entityType: "CASH_CHECK",
        description: JSON.stringify(check) });
      return check;
    });
    if (!saved) return response({ success: false, message: "예상 시재 또는 날짜가 변경되었습니다. 다시 확인해 주세요." }, 409);
    return response({ success: true, check: saved });
  } catch (error) {
    console.error("Cash check registration failed", error);
    return response({ success: false, message: "시재 확인을 기록하지 못했습니다." }, 500);
  }
}
