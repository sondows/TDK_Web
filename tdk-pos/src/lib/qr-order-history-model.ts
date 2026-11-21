const BILLABLE_QR_ORDER_STATUSES = new Set(["PENDING", "ACCEPTED"]);

export function isBillableQrOrderStatus(status: string): boolean {
  return BILLABLE_QR_ORDER_STATUSES.has(status);
}

/** Any returned order row is history, including employee-review and cancelled records. */
export function hasQrOrderHistory(orders: readonly unknown[]): boolean {
  return orders.length > 0;
}

export function sortQrOrdersNewestFirst<T extends { qrOrderId: number; orderedAt: string }>(orders: readonly T[]): T[] {
  return [...orders].sort((a, b) => b.orderedAt.localeCompare(a.orderedAt) || b.qrOrderId - a.qrOrderId);
}

export function qrOrderRoundNumber(index: number, orderCount: number): number {
  return Math.max(0, orderCount - index);
}

export function totalQrOrderAmount<T extends { status: string; totalAmount: string | number }>(orders: readonly T[]): number {
  return orders.reduce((total, order) => total + (isBillableQrOrderStatus(order.status) ? Number(order.totalAmount) || 0 : 0), 0);
}

export function aggregateQrOrderItems<
  TOrder extends { qrOrderId: number; status: string },
  TItem extends { qrOrderId: number; menuId: number; itemName: string; qty: number; totalAmount: string | number },
>(orders: readonly TOrder[], items: readonly TItem[]) {
  const orderById = new Map(orders.map(order => [order.qrOrderId, order]));
  const grouped = new Map<number, { menuId: number; itemName: string; qty: number; totalAmount: number }>();
  for (const item of items) {
    const order = orderById.get(item.qrOrderId);
    if (!order || !isBillableQrOrderStatus(order.status)) continue;
    const current = grouped.get(item.menuId);
    if (current) {
      current.qty += item.qty;
      current.totalAmount += Number(item.totalAmount) || 0;
    } else {
      grouped.set(item.menuId, { menuId: item.menuId, itemName: item.itemName, qty: item.qty, totalAmount: Number(item.totalAmount) || 0 });
    }
  }
  return [...grouped.values()];
}
