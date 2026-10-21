export function isOrphanedUnpaidCheckout(input: {
  checkoutStatus: string;
  paidAmount: number;
  completedAt: Date | string | null;
  itemStatuses: string[];
  paymentStatuses: string[];
}) {
  return (input.checkoutStatus === "OPEN" || input.checkoutStatus === "PARTIALLY_PAID")
    && input.paidAmount === 0
    && input.completedAt === null
    && input.itemStatuses.length > 0
    && input.itemStatuses.every(status => status === "CANCELLED")
    && !input.paymentStatuses.some(status => status === "APPROVED" || status === "PENDING");
}
