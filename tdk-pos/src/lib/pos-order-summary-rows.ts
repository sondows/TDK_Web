export type SummarySourceItem = {
  orderItemId: number;
  menuId: number;
  itemType: "NORMAL" | "COMPONENT" | "SERVICE";
  itemName: string;
  unitPrice: string;
  effectiveQty: number;
};

export type SummaryRow = {
  rowKey: string;
  name: string;
  qty: number;
  total: number;
  unitPrice: number;
};

export function buildOrderSummaryRows(items: SummarySourceItem[]): SummaryRow[] {
  const rows = new Map<string, SummaryRow>();
  for (const item of items) {
    if (item.effectiveQty <= 0) continue;
    const unitPrice = Number(item.unitPrice);
    // Components have their own saved order item. Ordinary items keep the existing
    // per-menu, per-price aggregation while remaining distinct from components.
    const rowKey = item.itemType === "COMPONENT"
      ? `component:${item.orderItemId}`
      : `${item.itemType.toLowerCase()}:${item.menuId}:${unitPrice}`;
    const row = rows.get(rowKey) ?? { rowKey, name: item.itemName, qty: 0, total: 0, unitPrice };
    row.qty += item.effectiveQty;
    row.total += unitPrice * item.effectiveQty;
    rows.set(rowKey, row);
  }
  return [...rows.values()];
}
