import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";

export async function PATCH(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const currentStaff = await getCurrentStaff();
  if (!currentStaff) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });

  const sessionId = Number((await params).sessionId);
  if (!Number.isInteger(sessionId) || sessionId <= 0) return Response.json({ success: false, message: "유효한 테이블 세션 번호가 필요합니다." }, { status: 400 });

  try {
    const [tableSession] = await db.select({ status: tableSessions.status }).from(tableSessions).where(eq(tableSessions.sessionId, sessionId)).limit(1);
    if (!tableSession) return Response.json({ success: false, message: "테이블 세션을 찾을 수 없습니다." }, { status: 404 });
    if (tableSession.status !== "OPEN") return Response.json({ success: false, message: "이미 종료되었거나 취소된 테이블입니다." }, { status: 409 });
    const [updateResult] = await db.update(tableSessions).set({ status: "CLOSED", closedAt: new Date(), closedByStaffId: currentStaff.staffId }).where(and(eq(tableSessions.sessionId, sessionId), eq(tableSessions.status, "OPEN")));
    if (updateResult.affectedRows !== 1) return Response.json({ success: false, message: "이미 종료되었거나 취소된 테이블입니다." }, { status: 409 });
    return Response.json({ success: true, message: "테이블 사용을 종료했습니다." });
  } catch {
    return Response.json({ success: false, message: "테이블 종료 처리에 실패했습니다." }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const currentStaff = await getCurrentStaff();
  const sharedMode = await getPosLoginMode() === "SHARED";
  if (!currentStaff && !sharedMode) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  const sessionId = Number((await params).sessionId);
  if (!Number.isInteger(sessionId) || sessionId <= 0) return Response.json({ success: false, message: "유효한 세션이 필요합니다." }, { status: 400 });
  try {
    const body = await request.json() as { personCount?: unknown; babyCount?: unknown };
    const personCount = Number(body.personCount);
    const babyCount = Number(body.babyCount);
    if (!Number.isInteger(personCount) || !Number.isInteger(babyCount) || personCount < 0 || personCount > 99 || babyCount < 0 || babyCount > 99) {
      return Response.json({ success: false, message: "성인과 아동 인원은 0~99명의 정수로 입력해 주세요." }, { status: 400 });
    }

    const updated = await db.update(tableSessions).set({ personCount, babyCount }).where(and(eq(tableSessions.sessionId, sessionId), eq(tableSessions.status, "OPEN")));
    if (updated[0].affectedRows !== 1) return Response.json({ success: false, message: "사용 중인 테이블 세션을 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ success: true, personCount, babyCount });
  } catch {
    return Response.json({ success: false, message: "인원 정보를 저장할 수 없습니다." }, { status: 500 });
  }
}
