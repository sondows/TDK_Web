/**
 * The server alone determines whether a cancellation leaves no effective
 * order quantity in the current table session. POS full-order cancellation
 * requires a PIN confirmation; authenticated HOS cancellation does not.
 */
export function shouldRequireCancellationPin(fullOrderCancellation: boolean, program: "POS" | "HOS" = "POS") {
  return program === "POS" && fullOrderCancellation;
}
