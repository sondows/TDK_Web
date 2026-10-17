type Payment = { paymentId: number; status: string; appliedAmount: string | number };
type LedgerEntry = { paymentId: number | null; amount: string | number };

/** An allocation belongs to this session; an unallocated payment is linked by checkout item. */
export function hasOutstandingTakeoutPayment(
  allocated: Payment[],
  unallocated: Payment[],
  ledgerEntries: LedgerEntry[],
) {
  const relevant = [...allocated, ...unallocated];
  const relevantIds = new Set(relevant.map(row => row.paymentId));
  const ledgerBalanceByPayment = new Map<number, number>();
  for (const row of ledgerEntries) if (row.paymentId !== null && relevantIds.has(row.paymentId))
    ledgerBalanceByPayment.set(row.paymentId, (ledgerBalanceByPayment.get(row.paymentId) ?? 0) + Math.round(Number(row.amount) * 100));
  return relevant.some(row =>
    (row.status === "APPROVED" && Number(row.appliedAmount) > 0) || (ledgerBalanceByPayment.get(row.paymentId) ?? 0) !== 0);
}
