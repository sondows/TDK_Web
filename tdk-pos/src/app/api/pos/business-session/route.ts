import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessSessionMutex, businessSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { businessSettings, ensureBusinessSession, BusinessSessionConflictError } from "@/lib/business-session";
import { resolveBusinessDate } from "@/lib/business-date";

async function authorized() { return Boolean(await getCurrentStaff()) || await getPosLoginMode() === "SHARED"; }

export async function GET() {
  if (!await authorized()) return Response.json({ success: false }, { status: 401 });
  const state = await db.transaction(async tx => {
    const [open] = await tx.select().from(businessSessions).where(eq(businessSessions.openGuard, 1)).limit(1);
    const settings = await businessSettings(tx);
    const [clock] = await tx.select({ local: sql<string>`DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s')` }).from(businessSessionMutex).limit(1);
    return { open, currentBusinessDate: resolveBusinessDate(clock.local, settings.cutoffTime) };
  });
  return Response.json({ success: true, session: state.open ? { id: state.open.businessSessionId, businessDate: state.open.businessDate, openingCashEnabled: state.open.openingCashEnabled === 1, isCarriedOver: state.open.businessDate !== state.currentBusinessDate } : null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!await authorized()) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => null) as { openingCash?: unknown } | null;
  const openingCash = body?.openingCash;
  if (typeof openingCash !== "number" || !Number.isSafeInteger(openingCash) || openingCash < 0 || openingCash > 999999999999)
    return Response.json({ success: false, message: "준비금을 0원 이상의 정수로 입력해 주세요." }, { status: 400 });
  try {
    const session = await db.transaction(tx => ensureBusinessSession(tx, openingCash));
    return Response.json({ success: true, session: { id: session.businessSessionId, businessDate: session.businessDate } });
  } catch (error) {
    if (error instanceof BusinessSessionConflictError) return Response.json({ success: false, message: error.message }, { status: 409 });
    console.error("Business session opening failed", error);
    return Response.json({ success: false, message: "영업을 시작하지 못했습니다." }, { status: 500 });
  }
}
