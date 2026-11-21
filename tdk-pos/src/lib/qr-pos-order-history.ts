export type PosOrderHistoryRow = {
  orderId: number;
  sessionId: number;
  orderType: string;
  status: string;
};

export function unlinkedPosOrdersForQrSession<T extends PosOrderHistoryRow>(
  posOrders: readonly T[],
  qrOrders: readonly { acceptedOrderId: number | null }[],
  currentSessionId: number | null,
): T[] {
  if (currentSessionId === null) return [];
  const acceptedPosOrderIds = new Set(qrOrders.flatMap(order => order.acceptedOrderId === null ? [] : [order.acceptedOrderId]));
  return posOrders.filter(order => order.sessionId === currentSessionId && order.orderType === "POS" &&
    order.status !== "CANCELLED" && !acceptedPosOrderIds.has(order.orderId));
}
