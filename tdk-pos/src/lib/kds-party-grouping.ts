/** Keep table sessions independent while placing members of a party in one card. */
export type KdsPartyTask = {
  sessionId: number;
  groupId: number | null;
  sessionKind: "DINE_IN" | "TAKEOUT_WALK_IN" | "TAKEOUT_PHONE";
  status: "WAITING" | "COOKING" | "DONE";
  cancelled: boolean;
};

export type KdsTableGroup<T> = { sessionId: number; tasks: T[] };
export type KdsPartyCard<T> = { key: string; tables: KdsTableGroup<T>[] };

/** Apply persisted per-table ranks without treating party/group membership as an ordering unit. */
export function sortKdsTableGroups<T extends { sessionId: number }>(
  tables: T[],
  order: Record<number, number>,
): T[] {
  return tables.map((table, index) => ({ table, index }))
    .sort((a, b) => {
      const aRank = order[a.table.sessionId];
      const bRank = order[b.table.sessionId];
      if (aRank !== undefined && bRank !== undefined && aRank !== bRank) return aRank - bRank;
      if (aRank !== undefined && bRank === undefined) return -1;
      if (aRank === undefined && bRank !== undefined) return 1;
      return a.index - b.index;
    })
    .map(({ table }) => table);
}

/** Reorder members of each party in place, without changing any party's global list slots. */
export function sortKdsPartyMembers<T extends { sessionId: number; groupKey: string }>(
  tables: T[],
  partyOrder: Record<number, number>,
): T[] {
  const result = [...tables];
  const positionsByParty = new Map<string, number[]>();
  for (const [index, table] of result.entries()) {
    if (!table.groupKey.startsWith("party:")) continue;
    const positions = positionsByParty.get(table.groupKey) ?? [];
    positions.push(index);
    positionsByParty.set(table.groupKey, positions);
  }
  for (const positions of positionsByParty.values()) {
    const members = positions.map(index => result[index]).sort((a, b) => {
      const aRank = partyOrder[a.sessionId];
      const bRank = partyOrder[b.sessionId];
      if (aRank !== undefined && bRank !== undefined && aRank !== bRank) return aRank - bRank;
      if (aRank !== undefined && bRank === undefined) return -1;
      if (aRank === undefined && bRank !== undefined) return 1;
      return 0;
    });
    positions.forEach((position, index) => { result[position] = members[index]; });
  }
  return result;
}

/** Move one table only inside its party; all other table and party slots remain unchanged. */
export function moveKdsPartyTable<T extends { sessionId: number }>(
  tables: T[],
  selectedSessionId: number,
  direction: "top" | "up" | "down" | "bottom",
): number[] {
  const ids = tables.map(table => table.sessionId);
  const index = ids.indexOf(selectedSessionId);
  if (index < 0) return ids;
  const next = [...ids];
  if (direction === "top" && index > 0) next.unshift(...next.splice(index, 1));
  else if (direction === "bottom" && index < next.length - 1) next.push(...next.splice(index, 1));
  else if (direction === "up" && index > 0) [next[index - 1], next[index]] = [next[index], next[index - 1]];
  else if (direction === "down" && index < next.length - 1) [next[index], next[index + 1]] = [next[index + 1], next[index]];
  return next;
}

/** Reorder a drag source among its party's members, leaving external groups untouched. */
export function reorderKdsPartyTableToTarget<T extends { sessionId: number }>(
  tables: T[],
  movingSessionId: number,
  targetSessionId: number,
): number[] {
  const ids = tables.map(table => table.sessionId);
  const sourceIndex = ids.indexOf(movingSessionId);
  const targetIndex = ids.indexOf(targetSessionId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return ids;
  const [moving] = ids.splice(sourceIndex, 1);
  ids.splice(ids.indexOf(targetSessionId) + (sourceIndex < targetIndex ? 1 : 0), 0, moving);
  return ids;
}

export function reorderKdsTableIds(ids: number[], movingId: number, targetIndex: number): number[] {
  const sourceIndex = ids.indexOf(movingId);
  if (sourceIndex < 0) return ids;
  const next = [...ids];
  next.splice(sourceIndex, 1);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, movingId);
  return next;
}

export function moveKdsTableToBoundary(ids: number[], movingId: number, boundary: "top" | "bottom"): number[] {
  return reorderKdsTableIds(ids, movingId, boundary === "top" ? 0 : ids.length - 1);
}

type KdsTableOrderUnit = { groupKey: string; sessionIds: number[] };

function collectKdsTableOrderUnits(tables: Array<{ sessionId: number; groupKey: string }>): KdsTableOrderUnit[] {
  const units: Array<{ groupKey: string; sessionIds: number[] }> = [];
  const unitByKey = new Map<string, { groupKey: string; sessionIds: number[] }>();
  for (const table of tables) {
    let unit = unitByKey.get(table.groupKey);
    if (!unit) {
      unit = { groupKey: table.groupKey, sessionIds: [] };
      unitByKey.set(table.groupKey, unit);
      units.push(unit);
    }
    if (!unit.sessionIds.includes(table.sessionId)) unit.sessionIds.push(table.sessionId);
  }
  return units;
}

/** Move the selected table's existing party group as one unit and flatten it for persisted ranks. */
export function moveKdsTableGroup(
  tables: Array<{ sessionId: number; groupKey: string }>,
  selectedSessionId: number,
  direction: "top" | "up" | "down" | "bottom",
): number[] {
  const units = collectKdsTableOrderUnits(tables);
  const selected = units.findIndex(unit => unit.sessionIds.includes(selectedSessionId));
  if (selected < 0) return tables.map(table => table.sessionId);

  if (direction === "top" && selected > 0) units.unshift(...units.splice(selected, 1));
  else if (direction === "bottom" && selected < units.length - 1) units.push(...units.splice(selected, 1));
  else if (direction === "up" && selected > 0) [units[selected - 1], units[selected]] = [units[selected], units[selected - 1]];
  else if (direction === "down" && selected < units.length - 1) [units[selected], units[selected + 1]] = [units[selected + 1], units[selected]];

  return units.flatMap(unit => unit.sessionIds);
}

/** Drag a party group next to the target table's group. */
export function reorderKdsTableGroupToTarget(
  tables: Array<{ sessionId: number; groupKey: string }>,
  movingSessionId: number,
  targetSessionId: number,
): number[] {
  const units = collectKdsTableOrderUnits(tables);
  const sourceIndex = units.findIndex(unit => unit.sessionIds.includes(movingSessionId));
  const targetIndex = units.findIndex(unit => unit.sessionIds.includes(targetSessionId));
  if (sourceIndex < 0 || targetIndex < 0) return tables.map(table => table.sessionId);
  if (sourceIndex === targetIndex) return units.flatMap(unit => unit.sessionIds);
  const [moving] = units.splice(sourceIndex, 1);
  const newTargetIndex = units.findIndex(unit => unit.sessionIds.includes(targetSessionId));
  const insertAt = sourceIndex < targetIndex ? newTargetIndex + 1 : newTargetIndex;
  units.splice(insertAt, 0, moving);
  return units.flatMap(unit => unit.sessionIds);
}

/** Restore table cards to first-received order while keeping existing party cards contiguous. */
export function sortKdsTableIdsByReceivedOrder<T extends {
  tables: Array<{ sessionId: number; tasks: Array<{ orderedAtMs: number }> }>;
}>(cards: T[]): number[] {
  const firstReceivedAt = (tasks: Array<{ orderedAtMs: number }>) => {
    const times = tasks.map(task => task.orderedAtMs).filter(Number.isFinite);
    return times.length ? Math.min(...times) : null;
  };
  const compareReceivedAt = (a: number | null, b: number | null) => {
    if (a !== null && b !== null) return a - b;
    if (a !== null) return -1;
    if (b !== null) return 1;
    return 0;
  };

  return cards.map((card, cardIndex) => {
    const tables = card.tables.map((table, tableIndex) => ({
      table,
      tableIndex,
      receivedAt: firstReceivedAt(table.tasks),
    })).sort((a, b) => compareReceivedAt(a.receivedAt, b.receivedAt) || a.tableIndex - b.tableIndex);
    const receivedAt = tables.reduce<number | null>((earliest, entry) =>
      entry.receivedAt === null ? earliest : earliest === null ? entry.receivedAt : Math.min(earliest, entry.receivedAt), null);
    return { tables, receivedAt, cardIndex };
  }).sort((a, b) => compareReceivedAt(a.receivedAt, b.receivedAt) || a.cardIndex - b.cardIndex)
    .flatMap(card => card.tables.map(entry => entry.table.sessionId));
}

/** Keep the submitted visible order, then append tables added after that client snapshot. */
export function completeKdsTableOrder(
  requestedIds: number[],
  activeIds: number[],
  existingRanks: Record<number, number>,
  fallbackOrder: Record<number, number>,
): number[] | null {
  const unique = new Set(requestedIds);
  const active = new Set(activeIds);
  if (unique.size !== requestedIds.length || requestedIds.some(id => !active.has(id))) return null;
  const missing = activeIds.filter(id => !unique.has(id)).sort((a, b) => {
    const aRank = existingRanks[a]; const bRank = existingRanks[b];
    if (aRank !== undefined && bRank !== undefined && aRank !== bRank) return aRank - bRank;
    if (aRank !== undefined && bRank === undefined) return -1;
    if (aRank === undefined && bRank !== undefined) return 1;
    return (fallbackOrder[a] ?? 0) - (fallbackOrder[b] ?? 0);
  });
  return [...requestedIds, ...missing];
}

/** Only tasks with the same pot recipe and identical cooking state share one control. */
export function groupKdsPotDisplayRows<T extends {
  sessionId: number; kind: "POT" | "SOLO"; sessionKind: KdsPartyTask["sessionKind"];
  compatibilityKey: string; status: "WAITING" | "COOKING" | "DONE";
  startedAtMs: number | null; completedAtMs: number | null; completionRequestId: string | null;
  completionRequestScope: "TASK" | "TABLE" | null; completionRequestedAtMs: number | null; cancelled: boolean;
  items: Array<{ name: string; kind: string }>;
}>(tasks: T[]): T[][] {
  const rows: T[][] = [];
  const keys = new Map<string, T[]>();
  for (const task of tasks) {
    if (task.kind !== "POT" || task.sessionKind !== "DINE_IN" || task.cancelled) { rows.push([task]); continue; }
    const key = [task.sessionId, task.compatibilityKey, task.status, task.startedAtMs, task.completedAtMs,
      task.completionRequestScope, task.completionRequestId, task.completionRequestedAtMs].join(":");
    let row = keys.get(key);
    if (!row) { row = []; keys.set(key, row); rows.push(row); }
    row.push(task);
  }
  for (const row of rows) if (row.length > 1) row.sort((a, b) =>
    Number(b.items.some(item => item.kind === "POT" && item.name === "흑돼지김치찌개")) -
    Number(a.items.some(item => item.kind === "POT" && item.name === "흑돼지김치찌개")));
  return rows;
}

export function activeKdsTableTasks<T extends KdsPartyTask>(tasks: T[]) {
  return tasks.filter(task => !task.cancelled && task.status !== "DONE");
}

export function oldestKdsTableOrderedAtMs<T extends KdsPartyTask & { orderedAtMs: number }>(tasks: T[], preparing: boolean) {
  const active = preparing ? activeKdsTableTasks(tasks) : [];
  return Math.min(...(active.length ? active : tasks).map(task => task.orderedAtMs));
}

export function groupKdsTasksByParty<T extends KdsPartyTask>(tasks: T[]): KdsPartyCard<T>[] {
  const cards = new Map<string, { card: KdsPartyCard<T>; tables: Map<number, KdsTableGroup<T>> }>();
  for (const task of tasks) {
    const key = task.sessionKind === "DINE_IN" && task.groupId !== null
      ? `party:${task.groupId}` : `session:${task.sessionId}`;
    let entry = cards.get(key);
    if (!entry) {
      entry = { card: { key, tables: [] }, tables: new Map() };
      cards.set(key, entry);
    }
    let table = entry.tables.get(task.sessionId);
    if (!table) {
      table = { sessionId: task.sessionId, tasks: [] };
      entry.tables.set(task.sessionId, table);
      entry.card.tables.push(table);
    }
    table.tasks.push(task);
  }
  return [...cards.values()].map(({ card }) => card);
}

export function preparingKdsPartyCards<T extends KdsPartyTask>(cards: KdsPartyCard<T>[]): KdsPartyCard<T>[] {
  return cards.flatMap(card => {
    const tables = card.tables.filter(table => table.tasks.some(task => task.status !== "DONE" || task.cancelled));
    return tables.length ? [{ ...card, tables }] : [];
  });
}

export function sortKdsPartyCardsByLatestOrder<T extends KdsPartyTask & { orderedAtMs: number }>(cards: KdsPartyCard<T>[]): KdsPartyCard<T>[] {
  const latestOrder = (table: KdsTableGroup<T>) => Math.max(...table.tasks.map(task => task.orderedAtMs));
  const sorted = cards.map(card => ({
    ...card,
    tables: [...card.tables].sort((a, b) => latestOrder(b) - latestOrder(a) || a.sessionId - b.sessionId),
  }));
  return sorted.sort((a, b) => latestOrder(b.tables[0]) - latestOrder(a.tables[0]) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export const partyHasActiveTask = <T extends KdsPartyTask>(card: KdsPartyCard<T>) =>
  card.tables.some(table => table.tasks.some(task => task.status !== "DONE" || task.cancelled));

export function countKdsTablesByStatus<T extends KdsPartyTask>(cards: KdsPartyCard<T>[], status: "preparing" | "completed") {
  return cards.reduce((count, card) => count + card.tables.filter(table => table.tasks.some(task =>
    !task.cancelled && (status === "preparing" ? task.status !== "DONE" : task.status === "DONE"),
  )).length, 0);
}
