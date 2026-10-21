import { getCurrentKdsAccount } from "@/lib/kds-auth";
import { undoKdsTableStart, startKdsTable, KdsActionError } from "@/lib/kds-server";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!(await getCurrentKdsAccount())) {
    return Response.json({ success: false, message: "KDS 로그인이 필요합니다." }, { status: 401 });
  }
  const sessionId = Number((await params).sessionId);
  const body = await request.json().catch(() => null) as { action?: unknown; batchStartId?: unknown } | null;
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0 || !body ||
    !["START", "UNDO"].includes(String(body.action)) ||
    (body.action === "UNDO" && (typeof body.batchStartId !== "string" || body.batchStartId.length > 36))) {
    return Response.json({ success: false, message: "테이블 조리 작업 요청을 확인해 주세요." }, { status: 400 });
  }
  try {
    const result = body.action === "UNDO"
      ? await undoKdsTableStart(sessionId, body.batchStartId as string)
      : await startKdsTable(sessionId);
    return Response.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof KdsActionError) {
      return Response.json({ success: false, message: error.message }, { status: error.statusCode });
    }
    console.error("KDS 테이블 일괄 시작 오류:", error);
    return Response.json({ success: false, message: "테이블 조리 작업을 시작하지 못했습니다." }, { status: 500 });
  }
}
