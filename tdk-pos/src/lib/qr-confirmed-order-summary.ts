import type { SummaryRow, SummarySourceItem } from "@/lib/pos-order-summary-rows";

export type QrConfirmedOrder = { orderId: number; status: string };
export type QrConfirmedOrderItem = SummarySourceItem & { status: string; actualComponentQty?: number | null };
export type QrOrderItemCancellation = { orderItemId: number; cancelledQty: number };

/** Uses the same item grouping and effective-price rules as the POS summary tab. */
export function buildQrConfirmedOrderSummary(input: {
  orders: readonly QrConfirmedOrder[];
  items: readonly QrConfirmedOrderItem[];
  cancellations: readonly QrOrderItemCancellation[];
  discountAmount: number;
  prepaidAmount: number;
}, groupItems: (items: SummarySourceItem[]) => SummaryRow[]) {
  const eligibleOrders = new Map(input.orders.filter(order => order.status === "ACCEPTED" || order.status === "COMPLETED")
    .map(order => [order.orderId, order]));
  const cancelledByItem = new Map<number, number>();
  for (const cancellation of input.cancellations) {
    cancelledByItem.set(cancellation.orderItemId, (cancelledByItem.get(cancellation.orderItemId) ?? 0) + cancellation.cancelledQty);
  }

  const effectiveItems = input.items.flatMap(item => {
    const order = eligibleOrders.get(item.orderId);
    if (!order) return [];
    const originalQty = item.itemType === "COMPONENT" && item.actualComponentQty !== null && item.actualComponentQty !== undefined
      ? item.actualComponentQty : item.qty ?? item.effectiveQty;
    const effectiveQty = item.status === "CANCELLED"
      ? 0 : Math.max(0, originalQty - (cancelledByItem.get(item.orderItemId) ?? 0));
    return [{ ...item, qty: item.qty ?? originalQty, effectiveQty }];
  });
  const rows = groupItems(effectiveItems);
  const grossCents = rows.reduce((sum, row) => sum + Math.round(row.total * 100), 0);
  const discountCents = Math.max(0, Math.round(input.discountAmount * 100));
  const prepaidCents = Math.max(0, Math.round(input.prepaidAmount * 100));
  const totalCents = Math.max(0, grossCents - discountCents);
  const receivableCents = Math.max(0, totalCents - prepaidCents);

  return {
    rows,
    grossAmount: grossCents / 100,
    discountAmount: discountCents / 100,
    prepaidAmount: prepaidCents / 100,
    totalAmount: totalCents / 100,
    receivableAmount: receivableCents / 100,
  };
}
