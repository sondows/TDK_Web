import { getCurrentKdsStaff } from "@/lib/kds-auth";
import { undoKdsTableStart, startKdsTable, KdsActionError } from "@/lib/kds-server";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!(await getCurrentKdsStaff())) {
    return Response.json({ success: false, message: "KDS 로그인이 필요합니다." }, { status: 401 });
  }
  const sessionId = Number((await params).sessionId);
  const body = await request.json().catch(() => null) as { action?: unknown; batchStartId?: unknown; taskIds?: unknown; queuedUndoDelayMs?: unknown } | null;
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0 || !body ||
    !["START", "UNDO"].includes(String(body.action)) ||
    (body.action === "UNDO" && (typeof body.batchStartId !== "string" || body.batchStartId.length > 36 ||
      !Array.isArray(body.taskIds) || body.taskIds.length === 0 || body.taskIds.length > 1000 ||
      !body.taskIds.every(taskId => Number.isSafeInteger(taskId) && Number(taskId) > 0)))) {
    return Response.json({ success: false, message: "테이블 조리 작업 요청을 확인해 주세요." }, { status: 400 });
  }
  if (body.queuedUndoDelayMs !== undefined && (!Number.isInteger(body.queuedUndoDelayMs) ||
    (body.queuedUndoDelayMs as number) < 0 || (body.queuedUndoDelayMs as number) > 3000)) {
    return Response.json({ success: false, message: "조리 시작 취소 시각을 확인할 수 없습니다." }, { status: 400 });
  }
  try {
    const dbStartedAt = performance.now();
    const result = body.action === "UNDO"
      ? await undoKdsTableStart(sessionId, body.batchStartId as string, body.taskIds as number[], body.queuedUndoDelayMs as number | undefined)
      : await startKdsTable(sessionId);
    return Response.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store",
      "Server-Timing": `kds-db;dur=${(performance.now() - dbStartedAt).toFixed(1)}` } });
  } catch (error) {
    if (error instanceof KdsActionError) {
      return Response.json({ success: false, message: error.message }, { status: error.statusCode });
    }
    console.error("KDS 테이블 일괄 시작 오류:", error);
    return Response.json({ success: false, message: "테이블 조리 작업을 시작하지 못했습니다." }, { status: 500 });
  }
}
