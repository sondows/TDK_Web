const closingTotals = [
  "businessDate", "openingCashEnabled", "openingCash", "totalSales", "saleCount",
  "discountAmount", "discountCount", "cardAmount", "cardCount", "cashAmount", "cashCount",
  "otherAmount", "otherCount", "customerPaymentAmount", "customerPaymentCount",
  "bankTransferAmount", "cancellationCount", "refundAmount", "dineCount", "dineAmount",
  "takeoutCount", "takeoutAmount", "cashReceived", "cashReturned", "cashLedgerMovement",
  "otherCashChange", "expectedCash",
] as const;

/** A repeated close with unchanged totals and cash count is the same settlement, even with a new request key. */
export function sameDailyClosingResult(prior: Record<string, unknown>, current: Record<string, unknown>, actualCash: number | null, actualCashFund: unknown) {
  return closingTotals.every(key => prior[key] === current[key]) && prior.actualCash === actualCash &&
    JSON.stringify(prior.actualCashFund ?? null) === JSON.stringify(actualCashFund);
}
