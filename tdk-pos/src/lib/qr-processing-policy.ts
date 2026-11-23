export function canProcessQrOrder(status: string): boolean {
  return status === "PENDING";
}

export function shouldBlockQrTokenCancellation(pendingOrderCount: number): boolean {
  return pendingOrderCount > 0;
}

export function canBindAcceptedQrOrderSession(input: {
  orderQrSessionId: number;
  customerQrSessionId: number;
  candidateTableId: number;
  targetTableId: number;
  customerSessionId: number | null;
  customerStatus: string;
  customerExpired: boolean;
  hasOpenTableSession: boolean;
}): boolean {
  return input.orderQrSessionId === input.customerQrSessionId &&
    input.customerStatus === "ACTIVE" && !input.customerExpired &&
    input.candidateTableId === input.targetTableId &&
    (input.customerSessionId !== null || !input.hasOpenTableSession);
}

export function qrOrderBlockReason(input: {
  customerStatus: string;
  customerExpired: boolean;
  customerSessionId: number | null;
  hasOpenTableSession: boolean;
  tableSessionOpen: boolean;
  tableIdMatches: boolean;
  currentQrValid: boolean;
}): "EXPIRED" | "SESSION_CLOSED" | "TABLE_MISMATCH" | "INVITE_REQUIRED" | "QR_INVALID" | null {
  if (input.customerExpired) return "EXPIRED";
  if (input.customerStatus !== "ACTIVE") return "SESSION_CLOSED";
  if (!input.tableIdMatches) return "TABLE_MISMATCH";
  if (input.customerSessionId !== null && !input.tableSessionOpen) return "SESSION_CLOSED";
  if (input.customerSessionId === null && input.hasOpenTableSession) return "INVITE_REQUIRED";
  if (!input.currentQrValid) return "QR_INVALID";
  return null;
}

export function shouldBlockQrCodeChange(pendingOrderCount: number): boolean {
  return pendingOrderCount > 0;
}

export function canHideRejectedQrOrder(status: string): boolean {
  return status === "REJECTED";
}
