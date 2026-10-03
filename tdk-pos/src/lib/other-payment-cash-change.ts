// Amounts are whole won. Integer multiplication keeps the 60% boundary exact.
export function meetsCashChangeThreshold(appliedAmount: number, submittedAmount: number, minPercent: number): boolean {
  return Number.isSafeInteger(appliedAmount) && Number.isSafeInteger(submittedAmount) &&
    Number.isInteger(minPercent) && minPercent >= 0 && minPercent <= 100 &&
    submittedAmount > 0 && appliedAmount >= 0 &&
    appliedAmount * 100 >= submittedAmount * minPercent;
}
