export type TableFinancials = { gross: number; discount: number; prepaid: number; total: number; remaining: number };

export function calculateTableFinancials(input: {
  tableScopes: Array<{ tableId: number; sessionIds: number[] }>;
  grossBySessionId: Map<number, number>;
  discountBySessionId: Map<number, number>;
  prepaidBySessionId: Map<number, number>;
}): Map<number, TableFinancials> {
  return new Map(input.tableScopes.map(({ tableId, sessionIds }) => {
    const uniqueSessionIds = [...new Set(sessionIds)];
    const gross = uniqueSessionIds.reduce((sum, sessionId) => sum + (input.grossBySessionId.get(sessionId) ?? 0), 0);
    const discount = uniqueSessionIds.reduce((sum, sessionId) => sum + (input.discountBySessionId.get(sessionId) ?? 0), 0);
    const prepaid = uniqueSessionIds.reduce((sum, sessionId) => sum + (input.prepaidBySessionId.get(sessionId) ?? 0), 0);
    const total = Math.max(0, gross - discount);
    return [tableId, { gross, discount, prepaid, total, remaining: Math.max(0, total - prepaid) }];
  }));
}
