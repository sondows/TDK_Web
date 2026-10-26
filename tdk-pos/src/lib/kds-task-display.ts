import type { KdsViewTask } from "@/lib/kds-server";
import { kdsCompletedElapsedMinutes } from "@/lib/kds-model";

const elapsedMinutes = (from: number, now: number) => Math.max(0, Math.floor((now - from) / 60_000));

/** Shared read-only timer label, based only on persisted KDS task timestamps. */
export function kdsTaskElapsedLabel(task: KdsViewTask, now: number): number | string {
  if (task.cancelled) return "주문 취소";
  if (task.status === "WAITING") return elapsedMinutes(task.orderedAtMs, now);
  if (task.status === "COOKING") return elapsedMinutes(task.startedAtMs ?? now, now);
  return kdsCompletedElapsedMinutes(task.completedAtMs, now) ?? "—";
}

export function kdsTaskStatusLabel(task: KdsViewTask): string {
  if (task.cancelled) return "주문 취소";
  if (task.completionRequestScope && task.completionRequestedAtMs !== null) return "조리완료";
  if (task.status === "WAITING") return "대기중";
  if (task.status === "COOKING") return "조리중";
  return "조리완료";
}
