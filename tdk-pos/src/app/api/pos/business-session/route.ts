import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cashOpeningFunds, staff } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { databaseToday } from "@/lib/daily-opening-cash";
import { lockBusinessMutex } from "@/lib/business-session";

async function actorId() {
  const current = await getCurrentStaff();
  if (current) return current.staffId;
  if (await getPosLoginMode() !== "SHARED") return null;
  const [shared] = await db.select({ id: staff.staffId }).from(staff)
    .where(and(eq(staff.staffCode, "000"), eq(staff.isActive, 1))).limit(1);
  return shared?.id ?? null;
}

export async function GET() {
  if (!await actorId()) return Response.json({ success: false }, { status: 401 });
  return Response.json({ success: true, session: null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const staffId = await actorId();
  if (!staffId) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => null) as { openingCash?: unknown } | null;
  const openingCash = body?.openingCash;
  if (typeof openingCash !== "number" || !Number.isSafeInteger(openingCash) || openingCash < 0 || openingCash > 999999999999)
    return Response.json({ success: false, message: "준비금을 0원 이상의 정수로 입력해 주세요." }, { status: 400 });
  try {
    const date = await db.transaction(async tx => {
      await lockBusinessMutex(tx);
      const today = await databaseToday(tx);
      await tx.insert(cashOpeningFunds).values({
        businessDate: today, otherAmount: openingCash, totalAmount: openingCash,
        createdByStaffId: staffId, updatedByStaffId: staffId,
      }).onDuplicateKeyUpdate({ set: { businessDate: today } });
      return today;
    });
    return Response.json({ success: true, businessDate: date });
  } catch (error) {
    console.error("Daily opening cash registration failed", error);
    return Response.json({ success: false, message: "오늘의 준비금을 저장하지 못했습니다." }, { status: 500 });
  }
}
