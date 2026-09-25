/**
 * Boundary for a future KSCAT/KSNET card-terminal integration.
 * Until a VAN specification is supplied, POS only records a clearly marked
 * manual-development card tender; no approval number is invented or stored.
 */
export type CardPaymentResult = {
  mode: "DEV_MANUAL";
  approvalNo: null;
  externalTransactionId: null;
};

export async function captureCardPayment(): Promise<CardPaymentResult> {
  return { mode: "DEV_MANUAL", approvalNo: null, externalTransactionId: null };
}
