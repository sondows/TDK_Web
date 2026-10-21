import { getCurrentKdsAccount } from "@/lib/kds-auth";
import { isKdsPostCookTimerMinutes } from "@/lib/kds-model";
import { cancelKdsTaskCompletion, finalizeKdsTaskCompletion, KdsActionError, requestKdsTaskCompletion, updateKdsTask } from "@/lib/kds-server";

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  if (!(await getCurrentKdsAccount())) {
    return Response.json({ success: false, message: "KDS 로그인이 필요합니다." }, { status: 401 });
  }
  const taskId = Number((await params).taskId);
  const body = await request.json().catch(() => null) as { action?: unknown; expectedStatus?: unknown; expectedChangedAtMs?: unknown; postCookTimerMinutes?: unknown; expectedRequestAtMs?: unknown } | null;
  const actions = ["MENU", "STATUS", "TIME", "ACK", "REQUEST_COMPLETION", "CANCEL_COMPLETION", "FINALIZE_COMPLETION"];
  if (!Number.isSafeInteger(taskId) || taskId <= 0 || !body || !actions.includes(String(body.action)) ||
    !["WAITING", "COOKING", "DONE"].includes(String(body.expectedStatus)) ||
    !(body.expectedChangedAtMs === null || (typeof body.expectedChangedAtMs === "number" && Number.isSafeInteger(body.expectedChangedAtMs) && body.expectedChangedAtMs >= 0))) {
    return Response.json({ success: false, message: "조리 작업과 조작을 확인해 주세요." }, { status: 400 });
  }
  if (body.postCookTimerMinutes !== undefined && !isKdsPostCookTimerMinutes(body.postCookTimerMinutes)) return Response.json({ success: false, message: "외부 끓임 시간은 1~60분 범위에서 선택해 주세요." }, { status: 400 });
  if (["CANCEL_COMPLETION", "FINALIZE_COMPLETION"].includes(String(body.action)) &&
    !(typeof body.expectedRequestAtMs === "number" && Number.isSafeInteger(body.expectedRequestAtMs) && body.expectedRequestAtMs >= 0)) {
    return Response.json({ success: false, message: "완료 요청 시각이 올바르지 않습니다." }, { status: 400 });
  }
  try {
    const expected = {
      status: body.expectedStatus as "WAITING" | "COOKING" | "DONE",
      changedAtMs: body.expectedChangedAtMs as number | null,
    };
    if (body.action === "REQUEST_COMPLETION") {
      const result = await requestKdsTaskCompletion(taskId, expected, body.postCookTimerMinutes as number | undefined);
      return Response.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "CANCEL_COMPLETION") {
      const result = await cancelKdsTaskCompletion(taskId, body.expectedRequestAtMs as number);
      return Response.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "FINALIZE_COMPLETION") {
      const completed = await finalizeKdsTaskCompletion(taskId, body.expectedRequestAtMs as number);
      return Response.json({ success: true, completed }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "TIME" && expected.status !== "DONE") return Response.json({ success: false, message: "완료는 5초 요청을 통해 처리해야 합니다." }, { status: 400 });
    await updateKdsTask(taskId, body.action as "MENU" | "STATUS" | "TIME" | "ACK", expected);
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof KdsActionError) {
      return Response.json({ success: false, message: error.message }, { status: error.statusCode });
    }
    console.error("KDS 작업 변경 오류:", error);
    return Response.json({ success: false, message: "조리 상태를 변경하지 못했습니다." }, { status: 500 });
  }
}
