export type QrWaitOrderStatus = "PENDING" | "ASSIGNED" | "CONFIRMED" | "CANCELLED" | "EXPIRED";

export function canAssignQrWaitOrder(status: QrWaitOrderStatus) {
  return status === "PENDING";
}

export function canEditQrWaitOrder(status: QrWaitOrderStatus) {
  return status === "PENDING";
}

export function canCancelQrWaitOrder(status: QrWaitOrderStatus) {
  return status === "PENDING" || status === "ASSIGNED";
}

export function needsQrWaitPriceAcknowledgement(estimate: string, current: string, acknowledged?: unknown) {
  return current !== estimate && acknowledged !== current;
}

export function qrWaitOrderIsExpired(expiresAt: Date, now: Date) {
  return expiresAt.getTime() <= now.getTime();
}
