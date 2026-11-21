export function canProcessQrOrder(status: string): boolean {
  return status === "PENDING";
}

export function shouldBlockQrTokenCancellation(pendingOrderCount: number): boolean {
  return pendingOrderCount > 0;
}

export function canAdoptQrOrderSession(input: {
  candidateTableId: number;
  targetTableId: number;
  candidateSessionId: number | null;
  qrSessionStatus: string;
  hasPendingOrder: boolean;
  hasOpenTableSession: boolean;
}): boolean {
  return !input.hasOpenTableSession && input.qrSessionStatus === "ACTIVE" &&
    input.candidateSessionId === null && input.candidateTableId === input.targetTableId && input.hasPendingOrder;
}

export function canHideRejectedQrOrder(status: string): boolean {
  return status === "REJECTED";
}
