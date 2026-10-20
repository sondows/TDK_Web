import { getCurrentKdsAccount } from "@/lib/kds-auth";
import { KdsActionError, updateKdsTask } from "@/lib/kds-server";

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  if (!(await getCurrentKdsAccount())) {
    return Response.json({ success: false, message: "KDS 로그인이 필요합니다." }, { status: 401 });
  }
  const taskId = Number((await params).taskId);
  const body = await request.json().catch(() => null) as { action?: unknown; expectedStatus?: unknown; expectedChangedAtMs?: unknown } | null;
  if (!Number.isSafeInteger(taskId) || taskId <= 0 || !body || !["MENU", "TIME", "ACK"].includes(String(body.action)) ||
    !["WAITING", "COOKING", "DONE"].includes(String(body.expectedStatus)) ||
    !(body.expectedChangedAtMs === null || (typeof body.expectedChangedAtMs === "number" && Number.isSafeInteger(body.expectedChangedAtMs) && body.expectedChangedAtMs >= 0))) {
    return Response.json({ success: false, message: "조리 작업과 조작을 확인해 주세요." }, { status: 400 });
  }
  try {
    await updateKdsTask(taskId, body.action as "MENU" | "TIME" | "ACK", {
      status: body.expectedStatus as "WAITING" | "COOKING" | "DONE",
      changedAtMs: body.expectedChangedAtMs as number | null,
    });
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof KdsActionError) {
      return Response.json({ success: false, message: error.message }, { status: error.statusCode });
    }
    console.error("KDS 작업 변경 오류:", error);
    return Response.json({ success: false, message: "조리 상태를 변경하지 못했습니다." }, { status: 500 });
  }
}
