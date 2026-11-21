type QrOrderForRound = { qrOrderId: number; orderedAt: string; acceptedOrderId: number | null };
type QrItemForRound = { qrOrderId: number };
type PosOrderForRound = { orderId: number; orderedAt: string; status: string; acceptedQrOrderId?: number | null };
type PosItemForRound = { orderId: number };

export type UnifiedQrOrderRound<TQrOrder, TQrItem, TPosOrder, TPosItem> =
  | { source: "QR"; roundNumber: number; order: TQrOrder; items: TQrItem[]; acceptedPosOrder: TPosOrder | null; acceptedPosItems: TPosItem[] }
  | { source: "POS"; roundNumber: number; order: TPosOrder; items: TPosItem[] };

/**
 * Combines each QR submission and each unlinked direct POS order into one
 * chronological round sequence. A POS order already created from QR approval
 * stays represented by its original QR submission.
 */
export function buildUnifiedQrOrderRounds<
  TQrOrder extends QrOrderForRound,
  TQrItem extends QrItemForRound,
  TPosOrder extends PosOrderForRound,
  TPosItem extends PosItemForRound,
>(qrOrders: readonly TQrOrder[], qrItems: readonly TQrItem[], posOrders: readonly TPosOrder[], posItems: readonly TPosItem[]) {
  type Entry =
    | { source: "QR"; order: TQrOrder; items: TQrItem[]; acceptedPosOrder: TPosOrder | null; acceptedPosItems: TPosItem[] }
    | { source: "POS"; order: TPosOrder; items: TPosItem[] };

  const linkedPosOrderIds = new Set(qrOrders.flatMap(order => order.acceptedOrderId === null ? [] : [order.acceptedOrderId]));
  const entries: Entry[] = [
    ...qrOrders.map(order => {
      const acceptedPosOrder = posOrders.find(posOrder => posOrder.acceptedQrOrderId === order.qrOrderId || posOrder.orderId === order.acceptedOrderId) ?? null;
      return { source: "QR" as const, order, items: qrItems.filter(item => item.qrOrderId === order.qrOrderId), acceptedPosOrder,
        acceptedPosItems: acceptedPosOrder ? posItems.filter(item => item.orderId === acceptedPosOrder.orderId) : [] };
    }),
    ...posOrders.filter(order => order.acceptedQrOrderId == null && !linkedPosOrderIds.has(order.orderId))
      .map(order => ({ source: "POS" as const, order, items: posItems.filter(item => item.orderId === order.orderId) })),
  ];

  const chronological = entries.sort((a, b) => {
    const aTime = Date.parse(a.order.orderedAt);
    const bTime = Date.parse(b.order.orderedAt);
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
    if (Number.isFinite(aTime) !== Number.isFinite(bTime)) return Number.isFinite(aTime) ? -1 : 1;
    const timestampOrder = a.order.orderedAt.localeCompare(b.order.orderedAt);
    if (timestampOrder !== 0) return timestampOrder;
    if (a.source !== b.source) return a.source === "QR" ? -1 : 1;
    const aId = a.source === "QR" ? a.order.qrOrderId : a.order.orderId;
    const bId = b.source === "QR" ? b.order.qrOrderId : b.order.orderId;
    return aId - bId;
  });

  return chronological.map((entry, index) => ({ ...entry, roundNumber: index + 1 })).reverse() as Array<UnifiedQrOrderRound<TQrOrder, TQrItem, TPosOrder, TPosItem>>;
}
