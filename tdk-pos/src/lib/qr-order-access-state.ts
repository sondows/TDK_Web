export type QrOrderAccessEvidence = {
  qrStatus: string | null;
  sessionId: number | null;
  tableStatus: string | null;
  sessionKind: string | null;
  expired: boolean;
  hasCompletedOrder: boolean;
  hasUnsettledOrder: boolean;
  hasPaidAllocation: boolean;
};

export type QrOrderAccessState = "AUTH_EXPIRED" | "AUTH_REQUIRED" | "PAYMENT_COMPLETED";

export function classifyQrOrderAccessState(evidence: QrOrderAccessEvidence): QrOrderAccessState {
  if (evidence.qrStatus === "CLOSED" && evidence.sessionId !== null && evidence.tableStatus === "CLOSED" && evidence.sessionKind === "DINE_IN" &&
    evidence.hasCompletedOrder && !evidence.hasUnsettledOrder && evidence.hasPaidAllocation) {
    return "PAYMENT_COMPLETED";
  }
  if (evidence.qrStatus === "ACTIVE" && (evidence.sessionId === null || evidence.tableStatus === "OPEN") && evidence.expired) {
    return "AUTH_EXPIRED";
  }
  return "AUTH_REQUIRED";
}
