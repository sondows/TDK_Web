export type TableFanAssignments = Record<string, number>;

export function parseTableFanAssignments(value: string | null | undefined): TableFanAssignments {
  if (!value) return {};
  const raw: unknown = JSON.parse(value);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid table fan assignments");
  const entries = Object.entries(raw);
  if (entries.some(([tableId, fanId]) => !/^[1-9]\d*$/.test(tableId) || !Number.isSafeInteger(Number(tableId)) ||
    !Number.isInteger(fanId) || Number(fanId) < 1 || Number(fanId) > 6)) throw new Error("Invalid table fan assignment");
  return Object.fromEntries(entries) as TableFanAssignments;
}

export function assignTableFan(current: TableFanAssignments, tableId: number, fanId: number | null) {
  if (!Number.isSafeInteger(tableId) || tableId < 1 ||
    !(fanId === null || (Number.isInteger(fanId) && fanId >= 1 && fanId <= 6))) throw new Error("Invalid table or fan ID");
  const next = { ...current };
  if (fanId === null) delete next[String(tableId)];
  else next[String(tableId)] = fanId;
  return next;
}
