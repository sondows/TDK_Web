export type ClosingSummary = { businessDate: string; totalSales: number; saleCount: number };

export function validClosing(value: unknown): value is ClosingSummary {
  if (!value || typeof value !== "object") return false;
  const closing = value as Partial<ClosingSummary>;
  return typeof closing.businessDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(closing.businessDate) &&
    Number.isFinite(closing.totalSales) && Number.isSafeInteger(closing.saleCount);
}

/** Use the persisted result to resolve a lost or malformed POST response. */
export async function confirmedClosing(key: string, request: typeof fetch = fetch): Promise<ClosingSummary | null> {
  try {
    const response = await request(`/api/pos/business-session/close?requestKey=${encodeURIComponent(key)}`, { cache: "no-store" });
    const result = await response.json() as { success?: boolean; closing?: unknown };
    return response.ok && result.success && validClosing(result.closing) ? result.closing : null;
  } catch { return null; }
}
