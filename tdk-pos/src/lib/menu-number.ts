const MAX_MENU_NUMBER = 2_147_483_647;

/** Returns undefined for invalid input and null for a deliberately blank number. */
export function parseMenuNumber(value: unknown): number | null | undefined {
  if (value === null || value === "") return null;

  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 && value <= MAX_MENU_NUMBER ? value : undefined;
  }

  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) return undefined;

  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_MENU_NUMBER ? parsed : undefined;
}
