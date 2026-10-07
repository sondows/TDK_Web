export type TableFinancials = { gross: number; discount: number; prepaid: number; total: number; remaining: number };

export function summarizeSessionFinancials(input: {
  sessionIds: number[];
  grossBySessionId: Map<number, number>;
  discountBySessionId: Map<number, number>;
  prepaidBySessionId: Map<number, number>;
}): TableFinancials {
  let gross = 0;
  let discount = 0;
  let prepaid = 0;
  let total = 0;
  let remaining = 0;

  for (const sessionId of new Set(input.sessionIds)) {
    const sessionGross = input.grossBySessionId.get(sessionId) ?? 0;
    const sessionDiscount = input.discountBySessionId.get(sessionId) ?? 0;
    const sessionPrepaid = input.prepaidBySessionId.get(sessionId) ?? 0;
    const sessionTotal = Math.max(0, sessionGross - sessionDiscount);

    gross += sessionGross;
    discount += sessionDiscount;
    prepaid += sessionPrepaid;
    total += sessionTotal;
    remaining += Math.max(0, sessionTotal - sessionPrepaid);
  }

  return { gross, discount, prepaid, total, remaining };
}

export function sumTableFinancials(financials: TableFinancials[]): TableFinancials {
  return financials.reduce((sum, item) => ({
    gross: sum.gross + item.gross,
    discount: sum.discount + item.discount,
    prepaid: sum.prepaid + item.prepaid,
    total: sum.total + item.total,
    remaining: sum.remaining + item.remaining,
  }), { gross: 0, discount: 0, prepaid: 0, total: 0, remaining: 0 });
}

export function calculateTableFinancials(input: {
  tableScopes: Array<{ tableId: number; sessionIds: number[] }>;
  grossBySessionId: Map<number, number>;
  discountBySessionId: Map<number, number>;
  prepaidBySessionId: Map<number, number>;
}): Map<number, TableFinancials> {
  return new Map(input.tableScopes.map(({ tableId, sessionIds }) => {
    return [tableId, summarizeSessionFinancials({ ...input, sessionIds })];
  }));
}
