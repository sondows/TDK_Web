export type QrTableIndicatorState = "NONE" | "TOKEN" | "ORDER_HISTORY";

export function qrTableIndicatorState(status: { hasActiveQrToken: boolean; hasPendingQrOrder: boolean; hasQrOrderHistory?: boolean }): QrTableIndicatorState {
  if (status.hasQrOrderHistory || status.hasPendingQrOrder) return "ORDER_HISTORY";
  if (!status.hasActiveQrToken) return "NONE";
  return "TOKEN";
}
