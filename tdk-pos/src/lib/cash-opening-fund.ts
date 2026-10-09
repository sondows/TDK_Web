export const CASH_DENOMINATIONS = [50_000, 10_000, 5_000, 1_000, 500, 100] as const;

export type CashDenomination = (typeof CASH_DENOMINATIONS)[number];
export type CashOpeningFund = {
  otherAmount: number;
  counts: Record<CashDenomination, number>;
};

export const EMPTY_CASH_OPENING_FUND: CashOpeningFund = {
  otherAmount: 0,
  counts: { 50_000: 0, 10_000: 0, 5_000: 0, 1_000: 0, 500: 0, 100: 0 },
};

export function cashOpeningFundTotal(fund: CashOpeningFund): number {
  return CASH_DENOMINATIONS.reduce((total, denomination) => total + denomination * fund.counts[denomination], fund.otherAmount);
}

export function parseCashOpeningFund(value: unknown): CashOpeningFund | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { otherAmount?: unknown; counts?: unknown };
  if (!Number.isSafeInteger(candidate.otherAmount) || Number(candidate.otherAmount) < 0 || Number(candidate.otherAmount) > 1_000_000_000_000) return null;
  if (typeof candidate.counts !== "object" || candidate.counts === null) return null;
  const supplied = candidate.counts as Record<number, unknown>;
  const counts = {} as CashOpeningFund["counts"];
  for (const denomination of CASH_DENOMINATIONS) {
    const count = supplied[denomination];
    if (!Number.isSafeInteger(count) || Number(count) < 0 || Number(count) > 999_999) return null;
    counts[denomination] = Number(count);
  }
  return { otherAmount: Number(candidate.otherAmount), counts };
}
