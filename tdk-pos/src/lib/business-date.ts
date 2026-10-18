/** Inputs are store-local wall-clock values read from the database server. */
export function resolveBusinessDate(localDateTime: string, cutoffTime: string): string {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(localDateTime) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoffTime)) throw new Error("Invalid business date input");
  const date = localDateTime.slice(0, 10);
  if (localDateTime.slice(11, 16) >= cutoffTime) return date;
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

export function isValidCutoffTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
