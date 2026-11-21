export function countHosTablesWithOrders(tables: readonly { isMergedSource: boolean; hasConfirmedOrder?: boolean }[]) {
  return tables.filter(table => !table.isMergedSource && table.hasConfirmedOrder === true).length;
}

export function formatHosNavBadge(count: number | null | undefined) {
  if (!Number.isSafeInteger(count) || Number(count) <= 0) return null;
  return Number(count) >= 100 ? "99+" : String(count);
}
