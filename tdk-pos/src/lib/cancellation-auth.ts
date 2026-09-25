/**
 * Ordinary item cancellations never interrupt the POS flow with a PIN prompt.
 * The server alone determines whether the requested cancellation leaves no
 * effective order quantity in the current table session; only that whole-order
 * operation requires a real staff PIN confirmation.
 */
export function shouldRequireCancellationPin(fullOrderCancellation: boolean) {
  return fullOrderCancellation;
}
