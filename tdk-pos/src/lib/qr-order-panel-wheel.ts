export type QrPanelWheelDirection = -1 | 1;

export type QrPanelWheelIntent = {
  direction: QrPanelWheelDirection;
  accumulated: number;
  advanced: boolean;
};

export type QrPanelWheelIntentResult = {
  intent: QrPanelWheelIntent;
  shouldAdvance: boolean;
};

export function accumulateQrPanelWheelIntent(
  current: QrPanelWheelIntent | null,
  deltaY: number,
  threshold = 48,
): QrPanelWheelIntentResult | null {
  if (!Number.isFinite(deltaY) || deltaY === 0 || !Number.isFinite(threshold) || threshold <= 0) return null;

  const direction: QrPanelWheelDirection = deltaY < 0 ? -1 : 1;
  const currentForDirection = current?.direction === direction
    ? current
    : { direction, accumulated: 0, advanced: false };

  if (currentForDirection.advanced) return { intent: currentForDirection, shouldAdvance: false };

  const accumulated = Math.min(threshold, currentForDirection.accumulated + Math.abs(deltaY));
  const shouldAdvance = accumulated >= threshold;
  return {
    intent: { direction, accumulated, advanced: shouldAdvance },
    shouldAdvance,
  };
}
