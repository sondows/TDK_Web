import { getCurrentKdsStaff } from "@/lib/kds-auth";
import { isKdsPostCookTimerMinutes, isKdsSelectedPotTasks, type KdsTaskStatus } from "@/lib/kds-model";
import { cancelKdsTableCompletion, finalizeKdsTableCompletion, KdsActionError, requestKdsTableCompletion } from "@/lib/kds-server";
import { getKdsCookingSettings } from "@/lib/kds-cooking-settings";
import { getKdsCompletionCountdownSeconds } from "@/lib/kds-completion-countdown-setting";

type ExpectedTask = { taskId: number; status: KdsTaskStatus; changedAtMs: number | null };

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!(await getCurrentKdsStaff())) {
    return Response.json({ success: false, message: "KDS 로그인이 필요합니다." }, { status: 401 });
  }
  const sessionId = Number((await params).sessionId);
  const body = await request.json().catch(() => null) as {
    action?: unknown; tasks?: unknown; requestId?: unknown; requestedAtMs?: unknown; immediate?: unknown; selectedPotTasks?: unknown; postCookTimerMinutes?: unknown;
  } | null;
  const action = String(body?.action ?? "REQUEST");
  const validTask = (task: unknown): task is ExpectedTask => {
    if (!task || typeof task !== "object") return false;
    const value = task as Record<string, unknown>;
    return Number.isSafeInteger(value.taskId) && Number(value.taskId) > 0 &&
      ["WAITING", "COOKING"].includes(String(value.status)) &&
      (value.changedAtMs === null || (typeof value.changedAtMs === "number" && Number.isSafeInteger(value.changedAtMs) && value.changedAtMs >= 0));
  };
  const validRequestRef = typeof body?.requestId === "string" && body.requestId.length <= 36 &&
    typeof body.requestedAtMs === "number" && Number.isSafeInteger(body.requestedAtMs) && body.requestedAtMs >= 0;
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0 || !body || !["REQUEST", "CANCEL", "FINALIZE"].includes(action) ||
    (action === "REQUEST" && (!Array.isArray(body.tasks) || !body.tasks.every(validTask) ||
      !isKdsSelectedPotTasks(body.selectedPotTasks) ||
      (body.postCookTimerMinutes !== undefined && !isKdsPostCookTimerMinutes(body.postCookTimerMinutes)))) ||
    (action !== "REQUEST" && !validRequestRef)) {
    return Response.json({ success: false, message: "테이블 조리 작업 요청을 확인해 주세요." }, { status: 400 });
  }
  try {
    if (action === "REQUEST") {
      const settings = await getKdsCookingSettings();
      if (body.postCookTimerMinutes !== undefined && !settings.boilTimeOptions.includes(body.postCookTimerMinutes as number)) {
        return Response.json({ success: false, message: "선택한 끓임 시간이 설정과 일치하지 않습니다." }, { status: 400 });
      }
      const countdownSeconds = await getKdsCompletionCountdownSeconds();
      const result = await requestKdsTableCompletion(sessionId, body.tasks as ExpectedTask[],
        body.postCookTimerMinutes === undefined ? settings.defaultBoilTimeMinutes : body.postCookTimerMinutes as 3 | 5 | 10,
        countdownSeconds, body.selectedPotTasks === true);
      return Response.json({ success: true, ...result, serverNowMs: Date.now() }, { headers: { "Cache-Control": "no-store" } });
    }
    const result = action === "CANCEL"
      ? await cancelKdsTableCompletion(sessionId, body.requestId as string, body.requestedAtMs as number)
      : { completed: await finalizeKdsTableCompletion(sessionId, body.requestId as string, body.requestedAtMs as number, body.immediate === true) };
    return Response.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof KdsActionError) return Response.json({ success: false, message: error.message }, { status: error.statusCode });
    console.error("KDS table completion action failed", { action, sessionId, requestId: body?.requestId, requestedAtMs: body?.requestedAtMs, error });
    return Response.json({ success: false, message: "테이블 전체 완료를 처리하지 못했습니다." }, { status: 500 });
  }
}
