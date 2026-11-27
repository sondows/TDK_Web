type QrOrderForRound = { qrOrderId: number; orderedAt: string; acceptedOrderId: number | null };
type QrItemForRound = { qrOrderId: number };
type PosOrderForRound = { orderId: number; orderedAt: string; status: string; acceptedQrOrderId?: number | null };
type PosItemForRound = { orderId: number };

export type UnifiedQrOrderRound<TQrOrder, TQrItem, TPosOrder, TPosItem> =
  | { source: "QR"; roundNumber: number; order: TQrOrder; items: TQrItem[]; acceptedPosOrder: TPosOrder; acceptedPosItems: TPosItem[] }
  | { source: "POS"; roundNumber: number; order: TPosOrder; items: TPosItem[] };

/** Every confirmed order has one POS order row. QR requests only annotate their accepted POS order. */
export function buildUnifiedQrOrderRounds<
  TQrOrder extends QrOrderForRound,
  TQrItem extends QrItemForRound,
  TPosOrder extends PosOrderForRound,
  TPosItem extends PosItemForRound,
>(qrOrders: readonly TQrOrder[], qrItems: readonly TQrItem[], posOrders: readonly TPosOrder[], posItems: readonly TPosItem[]) {
  const qrByPosId = new Map(qrOrders.flatMap(order => order.acceptedOrderId === null
    ? [] : [[order.acceptedOrderId, order] as const]));
  const chronological = [...posOrders].sort((a, b) => {
    const aTime = Date.parse(a.orderedAt);
    const bTime = Date.parse(b.orderedAt);
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
    const textOrder = a.orderedAt.localeCompare(b.orderedAt);
    return textOrder || a.orderId - b.orderId;
  });
  return chronological.map((posOrder, index) => {
    const qrOrder = qrByPosId.get(posOrder.orderId);
    return qrOrder
      ? { source: "QR" as const, roundNumber: index + 1, order: qrOrder,
          items: qrItems.filter(item => item.qrOrderId === qrOrder.qrOrderId), acceptedPosOrder: posOrder,
          acceptedPosItems: posItems.filter(item => item.orderId === posOrder.orderId) }
      : { source: "POS" as const, roundNumber: index + 1, order: posOrder,
          items: posItems.filter(item => item.orderId === posOrder.orderId) };
  }).reverse() as Array<UnifiedQrOrderRound<TQrOrder, TQrItem, TPosOrder, TPosItem>>;
}
