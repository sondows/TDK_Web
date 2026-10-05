export type SessionPaymentAllocation = { sessionId: number; amount: number };

export function allocatePaymentAcrossSessions(input: {
  baseSessionId: number;
  appliedAmount: number;
  balanceBySessionId: Map<number, number>;
  paidBySessionId: Map<number, number>;
}): SessionPaymentAllocation[] {
  let unallocated = Math.max(0, Math.floor(input.appliedAmount));
  const order = [input.baseSessionId, ...input.balanceBySessionId.keys()].filter(
    (sessionId, index, all) => all.indexOf(sessionId) === index,
  );
  const allocations: SessionPaymentAllocation[] = [];

  for (const sessionId of order) {
    if (!unallocated) break;
    const balance = Math.max(0, Math.floor(input.balanceBySessionId.get(sessionId) ?? 0));
    const alreadyPaid = Math.max(0, Math.floor(input.paidBySessionId.get(sessionId) ?? 0));
    const amount = Math.min(unallocated, Math.max(0, balance - alreadyPaid));
    if (!amount) continue;
    allocations.push({ sessionId, amount });
    unallocated -= amount;
  }

  if (unallocated > 0) throw new Error("결제 금액을 일행 테이블별 잔액에 배분할 수 없습니다.");
  return allocations;
}
