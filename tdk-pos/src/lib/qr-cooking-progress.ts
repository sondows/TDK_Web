export type QrCookingStage = "WAITING" | "COOKING" | "DONE" | null;

const qrCookingProgressCategories = new Set(["김치찌개", "찌개"]);

export function isQrCookingProgressMenu(input: { categoryName: string | null; kdsKind: string; kdsVisible: boolean }) {
  return input.kdsVisible && input.kdsKind === "POT" && input.categoryName !== null &&
    qrCookingProgressCategories.has(input.categoryName.trim());
}

export type QrCookingProgressInput = {
  orderStatus: string;
  stage: QrCookingStage;
  postCookTimerEligible: boolean;
  postCookTimerMinutes: number | null;
  postCookTimerStartedAtMs: number | null;
};

export type QrCookingProgress = {
  currentStep: 1 | 2 | 3 | 4 | 5;
  tableBoilLabel: string;
  timerSegments: number;
  timerElapsedSegments: number;
};

export function getQrCookingProgress(input: QrCookingProgressInput, nowMs: number): QrCookingProgress | null {
  if (input.orderStatus !== "ACCEPTED" || input.stage === null) return null;

  const configuredMinutes = input.postCookTimerEligible && Number.isInteger(input.postCookTimerMinutes) &&
    Number(input.postCookTimerMinutes) >= 1 && Number(input.postCookTimerMinutes) <= 60
    ? Number(input.postCookTimerMinutes) : null;
  const hasTimerStart = input.postCookTimerStartedAtMs !== null && Number.isFinite(input.postCookTimerStartedAtMs) &&
    input.postCookTimerStartedAtMs > 0;
  const hasBoilTimer = input.stage === "DONE" && configuredMinutes !== null && hasTimerStart;
  const timerStartedAtMs = input.postCookTimerStartedAtMs;
  const timerElapsedSeconds = hasBoilTimer
    ? Math.max(0, (nowMs - (timerStartedAtMs ?? nowMs)) / 1_000)
    : 0;
  const segmentDurationSeconds = configuredMinutes === null ? null : configuredMinutes * 60 / 10;
  const boilingSeconds = configuredMinutes === null ? 0 : configuredMinutes * 60;
  const completionSeconds = boilingSeconds + 30;
  const isFinalComplete = hasBoilTimer && timerElapsedSeconds >= completionSeconds;
  const timerElapsedSegments = hasBoilTimer && !isFinalComplete && segmentDurationSeconds !== null
    ? Math.min(10, Math.floor(timerElapsedSeconds / segmentDurationSeconds))
    : 0;
  const currentStep = input.stage === "WAITING" ? 1
    : input.stage === "COOKING" ? 2
      : hasBoilTimer && !isFinalComplete ? 4 : 5;
  const timerSegments = hasBoilTimer && !isFinalComplete ? 10 : 0;
  const tableBoilLabel = currentStep === 4
    ? `테이블끓이기(${timerElapsedSegments * 10}%)`
    : "테이블끓이기";

  return {
    currentStep,
    tableBoilLabel,
    timerSegments,
    timerElapsedSegments,
  };
}
