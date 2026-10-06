export type MenuComponentInput = {
  componentMenuId: number;
  qtyPerUnit: number;
  printOnKitchen: boolean;
  printOnReceipt: boolean;
};

export function parseMenuComponentInputs(value: unknown): MenuComponentInput[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 50) return null;
  const seen = new Set<number>();
  const result: MenuComponentInput[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const componentMenuId = Number(row.componentMenuId);
    const qtyPerUnit = Number(row.qtyPerUnit);
    if (!Number.isSafeInteger(componentMenuId) || componentMenuId <= 0 || seen.has(componentMenuId) || !Number.isInteger(qtyPerUnit) || qtyPerUnit < 1 || qtyPerUnit > 1000 || typeof row.printOnKitchen !== "boolean" || typeof row.printOnReceipt !== "boolean") return null;
    seen.add(componentMenuId);
    result.push({ componentMenuId, qtyPerUnit, printOnKitchen: row.printOnKitchen, printOnReceipt: row.printOnReceipt });
  }
  return result;
}
