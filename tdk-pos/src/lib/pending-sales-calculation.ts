type Session = { sessionId: number; groupId: number | null };
type Merge = { sourceSessionId: number; destinationSessionId: number };
type Item = { orderItemId: number; sessionId: number; qty: number; unitPrice: string; status: string };
type Cancellation = { orderItemId: number; cancelledQty: number };
type Discount = { sessionId: number; discountAmount: string };
type CheckoutLink = { checkoutId: number; orderItemId: number; status: string };
type Payment = { checkoutId: number; appliedAmount: string };

export function calculatePendingSales(input: {
  sessions: Session[];
  merges: Merge[];
  items: Item[];
  cancellations: Cancellation[];
  discounts: Discount[];
  checkoutLinks: CheckoutLink[];
  payments: Payment[];
}): { amount: number; count: number } {
  const parent = new Map(input.sessions.map(session => [session.sessionId, session.sessionId]));
  const root = (id: number): number => {
    const next = parent.get(id);
    if (next === undefined || next === id) return id;
    const result = root(next);
    parent.set(id, result);
    return result;
  };
  const join = (left: number, right: number) => {
    if (parent.has(left) && parent.has(right)) parent.set(root(left), root(right));
  };
  const firstByGroup = new Map<number, number>();
  for (const session of input.sessions) {
    if (session.groupId === null) continue;
    const first = firstByGroup.get(session.groupId);
    if (first === undefined) firstByGroup.set(session.groupId, session.sessionId);
    else join(first, session.sessionId);
  }
  for (const merge of input.merges) join(merge.sourceSessionId, merge.destinationSessionId);

  const cancelledByItem = new Map<number, number>();
  for (const row of input.cancellations)
    cancelledByItem.set(row.orderItemId, (cancelledByItem.get(row.orderItemId) ?? 0) + row.cancelledQty);
  const grossByRoot = new Map<number, number>();
  const rootByItem = new Map<number, number>();
  for (const item of input.items) {
    if (item.status === "CANCELLED" || !parent.has(item.sessionId)) continue;
    const effectiveQty = Math.max(0, item.qty - (cancelledByItem.get(item.orderItemId) ?? 0));
    if (!effectiveQty) continue;
    const key = root(item.sessionId);
    rootByItem.set(item.orderItemId, key);
    grossByRoot.set(key, (grossByRoot.get(key) ?? 0) + effectiveQty * Number(item.unitPrice));
  }
  const discountsByRoot = new Map<number, number>();
  for (const row of input.discounts) {
    if (!parent.has(row.sessionId)) continue;
    const key = root(row.sessionId);
    discountsByRoot.set(key, (discountsByRoot.get(key) ?? 0) + Number(row.discountAmount));
  }
  const checkoutIdsByRoot = new Map<number, Set<number>>();
  for (const link of input.checkoutLinks) {
    if (link.status === "CANCELLED" || link.status === "REFUNDED") continue;
    const key = rootByItem.get(link.orderItemId);
    if (key === undefined) continue;
    if (!checkoutIdsByRoot.has(key)) checkoutIdsByRoot.set(key, new Set());
    checkoutIdsByRoot.get(key)!.add(link.checkoutId);
  }
  const paidByCheckout = new Map<number, number>();
  for (const payment of input.payments)
    paidByCheckout.set(payment.checkoutId, (paidByCheckout.get(payment.checkoutId) ?? 0) + Number(payment.appliedAmount));

  let amount = 0;
  let count = 0;
  for (const [key, gross] of grossByRoot) {
    const paid = [...(checkoutIdsByRoot.get(key) ?? [])].reduce((sum, checkoutId) => sum + (paidByCheckout.get(checkoutId) ?? 0), 0);
    const remaining = Math.max(0, Math.floor(gross - (discountsByRoot.get(key) ?? 0) - paid));
    if (remaining > 0) { amount += remaining; count++; }
  }
  return { amount, count };
}
