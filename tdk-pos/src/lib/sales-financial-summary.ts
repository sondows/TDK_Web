/** The completed-checkout money rules used by the existing sales summary. */
export type FinancialCheckout = { id: number; total: string | number; discount: string | number };
export type FinancialPayment = {
  checkoutId: number;
  appliedAmount: string | number;
  methodType: string;
  status: string;
  cancelledAt: string | null;
};

export const won = (value: string | number) => Math.max(0, Math.floor(Number(value)));

export function summarizeSalesFinancials(
  checkouts: FinancialCheckout[], payments: FinancialPayment[], startDate: string, endDate: string,
) {
  const approvedByCheckout = new Map<number, number>();
  let grossSales = 0, netSales = 0, transactionCount = 0, cancellationCount = 0;
  let discountAmount = 0, discountCount = 0, cancelledAmount = 0;
  let cardAmount = 0, cardCount = 0, cashAmount = 0, cashCount = 0, otherAmount = 0, otherCount = 0;
  let bankTransferAmount = 0;

  for (const checkout of checkouts) {
    grossSales += won(checkout.total);
    const discount = won(checkout.discount);
    discountAmount += discount;
    if (discount > 0) discountCount++;
  }
  for (const payment of payments) {
    const amount = won(payment.appliedAmount);
    if ((payment.status === "CANCELLED" || payment.status === "REFUNDED") && payment.cancelledAt && payment.cancelledAt >= startDate && payment.cancelledAt <= endDate) {
      cancelledAmount += amount;
      cancellationCount++;
    }
    if (payment.status !== "APPROVED") continue;
    netSales += amount;
    approvedByCheckout.set(payment.checkoutId, (approvedByCheckout.get(payment.checkoutId) ?? 0) + amount);
    if (payment.methodType === "CARD") { cardAmount += amount; cardCount++; }
    else if (payment.methodType === "CASH") { cashAmount += amount; cashCount++; }
    else {
      otherAmount += amount; otherCount++;
      if (payment.methodType === "TRANSFER") bankTransferAmount += amount;
    }
  }
  for (const checkout of checkouts) if ((approvedByCheckout.get(checkout.id) ?? 0) > 0) transactionCount++;
  return {
    grossSales, netSales, transactionCount, cancellationCount, discountAmount, discountCount, cancelledAmount,
    cardAmount, cardCount, cashAmount, cashCount, otherAmount, otherCount, bankTransferAmount,
  };
}
