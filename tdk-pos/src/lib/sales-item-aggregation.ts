export type SalesDisplayItem = {
  menuId: number;
  itemName: string;
  itemType: string;
  unitPrice: number;
  qty: number;
  amount: number;
};

export const salesItemAggregationKey = (menuId: number, unitPrice: number | string) =>
  JSON.stringify([menuId, Number(unitPrice)]);

/** Presentation-only aggregation within the caller's sale or checkout scope. */
export function aggregateSalesDisplayItems<T extends SalesDisplayItem>(items: T[]): T[] {
  const rows = new Map<string, T>();
  for (const item of items) {
    const key = salesItemAggregationKey(item.menuId, item.unitPrice);
    const current = rows.get(key);
    if (current) {
      current.qty += item.qty;
      current.amount += item.amount;
    } else {
      rows.set(key, { ...item });
    }
  }
  return [...rows.values()];
}
