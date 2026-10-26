export type GridSortDirection = "asc" | "desc";
export type GridSortState<Key extends string> = { key: Key; direction: GridSortDirection };
export type GridValueType = "date" | "number" | "text";

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[₩원,\s]/g, "");
  if (!normalized || normalized === "-" || normalized === "—") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedValue(value: unknown, type: GridValueType): number | string | null {
  if (value == null || value === "" || value === "-" || value === "—") return null;
  if (type === "number") return numberValue(value);
  if (type === "date") {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
    const timestamp = Date.parse(String(value));
    return Number.isNaN(timestamp) ? null : timestamp;
  }
  return String(value);
}

export function compareGridValues(a: unknown, b: unknown, type: GridValueType, direction: GridSortDirection): number {
  const left = normalizedValue(a, type);
  const right = normalizedValue(b, type);
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
  const comparison = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right), "ko", { numeric: true, sensitivity: "base" });
  return direction === "desc" ? -comparison : comparison;
}

export function sortGridRows<Row, Key extends string>(
  rows: readonly Row[],
  state: GridSortState<Key>,
  types: Record<Key, GridValueType>,
  getValue: (row: Row, key: Key) => unknown,
): Row[] {
  return rows.map((row, index) => ({ row, index })).sort((a, b) =>
    compareGridValues(getValue(a.row, state.key), getValue(b.row, state.key), types[state.key], state.direction) || a.index - b.index,
  ).map(({ row }) => row);
}

export function nextGridSort<Key extends string>(
  current: GridSortState<Key>,
  key: Key,
  defaultDirection: GridSortDirection,
): GridSortState<Key> {
  return current.key === key
    ? { key, direction: current.direction === "desc" ? "asc" : "desc" }
    : { key, direction: defaultDirection };
}
