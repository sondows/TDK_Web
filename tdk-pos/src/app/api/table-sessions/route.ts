import { db } from "@/db";
import { tableSessionMerges, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { and, eq, inArray } from "drizzle-orm";

export async function POST(request: Request) {
  try {
    const currentStaff = await getCurrentStaff();
    const sharedMode = await getPosLoginMode() === "SHARED";

    if (!currentStaff && !sharedMode) {
      return Response.json(
        { success: false, message: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const tableId = Number(body.tableId);
    const personCount = Number(body.personCount ?? 0);
    const babyCount = Number(body.babyCount ?? 0);

    if (!Number.isInteger(tableId) || tableId <= 0) {
      return Response.json(
        { success: false, message: "유효한 테이블 번호가 필요합니다." },
        { status: 400 }
      );
    }

    if (
      !Number.isInteger(personCount) ||
      !Number.isInteger(babyCount) ||
      personCount < 0 ||
      babyCount < 0
    ) {
      return Response.json(
        { success: false, message: "인원 수는 0 이상의 정수여야 합니다." },
        { status: 400 }
      );
    }

    const openSessions = await db
      .select({ sessionId: tableSessions.sessionId })
      .from(tableSessions)
      .where(
        and(
          eq(tableSessions.tableId, tableId),
          eq(tableSessions.status, "OPEN")
        )
      )
      ;

    const activeMergedSources = openSessions.length
      ? await db.select({ sourceSessionId: tableSessionMerges.sourceSessionId })
        .from(tableSessionMerges)
        .where(and(eq(tableSessionMerges.status, "ACTIVE"), inArray(tableSessionMerges.sourceSessionId, openSessions.map(session => session.sessionId))))
      : [];
    const mergedSourceIds = new Set(activeMergedSources.map(merge => merge.sourceSessionId));
    const openSession = openSessions.find(session => !mergedSourceIds.has(session.sessionId));

    if (openSession) {
      return Response.json(
        { success: false, message: "이미 사용 중인 테이블입니다." },
        { status: 409 }
      );
    }

    const [insertResult] = await db.insert(tableSessions).values({
      tableId,
      personCount,
      babyCount,
      status: "OPEN",
      openedByStaffId: currentStaff?.staffId,
    });

    return Response.json({
      success: true,
      message: "테이블 사용을 시작했습니다.",
      sessionId: Number(insertResult.insertId),
    });
  } catch (error) {
    console.error("테이블 세션 생성 오류:", error);

    return Response.json(
      { success: false, message: "테이블 세션 생성에 실패했습니다." },
      { status: 500 }
    );
  }
}
