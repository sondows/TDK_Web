export type QrPendingRoundSeed = {
  qrOrderId: number;
  tableId: number;
  sessionId: number | null;
  orderedAt: string;
};

/** Keeps round numbering stable across pending/processed orders in the same table session. */
export function assignQrOrderRoundNumbers<T extends QrPendingRoundSeed>(orders: readonly T[]) {
  const ordered = [...orders].sort((a, b) => a.orderedAt.localeCompare(b.orderedAt) || a.qrOrderId - b.qrOrderId);
  const counts = new Map<string, number>();
  return ordered.map(order => {
    const group = order.sessionId === null ? `table:${order.tableId}` : `session:${order.sessionId}`;
    const roundNumber = (counts.get(group) ?? 0) + 1;
    counts.set(group, roundNumber);
    return { ...order, roundNumber };
  });
}
