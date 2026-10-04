// Amounts are whole won. Integer multiplication keeps the 60% boundary exact.
export function meetsCashChangeThreshold(appliedAmount: number, submittedAmount: number, minPercent: number): boolean {
  return Number.isSafeInteger(appliedAmount) && Number.isSafeInteger(submittedAmount) &&
    Number.isInteger(minPercent) && minPercent >= 0 && minPercent <= 100 &&
    submittedAmount > 0 && appliedAmount >= 0 &&
    appliedAmount * 100 >= submittedAmount * minPercent;
}

export type QuantityBalancePolicy = "CASH_CHANGE" | "FORFEIT" | null;
export type QuantityOverageResult = {
  cashChange: number;
  forfeited: number;
  error: "THRESHOLD_MISSING" | "THRESHOLD_NOT_MET" | "CHANGE_DISABLED" | null;
};

/** Shared legacy quantity-voucher overage policy, also used for customer coupons. */
export function resolveQuantityOverage(input: {
  tenderedAmount: number;
  appliedAmount: number;
  balancePolicy: QuantityBalancePolicy;
  cashChangeEnabled: number | null;
  cashChangeMinPercent: number | null;
  prepaidCredit?: number;
  customerId?: number | null;
  customerOverpaymentWithoutCredit?: boolean;
}): QuantityOverageResult {
  const { tenderedAmount, appliedAmount, balancePolicy, cashChangeEnabled, cashChangeMinPercent } = input;
  const excess = Math.max(0, tenderedAmount - appliedAmount);
  if (!excess) return { cashChange: 0, forfeited: 0, error: null };
  const prepaidCredit = input.prepaidCredit ?? 0;
  const customerId = input.customerId ?? null;
  const customerOverpaymentWithoutCredit = input.customerOverpaymentWithoutCredit ?? false;
  if (prepaidCredit > 0) return { cashChange: 0, forfeited: 0, error: null };
  if (cashChangeEnabled === 1) {
    if (cashChangeMinPercent === null) return { cashChange: 0, forfeited: 0, error: "THRESHOLD_MISSING" };
    if (!meetsCashChangeThreshold(appliedAmount, tenderedAmount, cashChangeMinPercent)) return { cashChange: 0, forfeited: 0, error: "THRESHOLD_NOT_MET" };
    return { cashChange: excess, forfeited: 0, error: null };
  }
  if (cashChangeEnabled === 0) {
    if (customerOverpaymentWithoutCredit || balancePolicy !== "FORFEIT") return { cashChange: 0, forfeited: 0, error: "CHANGE_DISABLED" };
    return { cashChange: 0, forfeited: excess, error: null };
  }
  // NULL is retained for old payment-method settings created before the cash-change option.
  return {
    cashChange: customerOverpaymentWithoutCredit || (customerId === null && balancePolicy === "CASH_CHANGE") ? excess : 0,
    forfeited: customerId === null && balancePolicy === "FORFEIT" ? excess : 0,
    error: null,
  };
}
