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
    const tables = card.tables.flatMap(table => {
      const tasks = table.tasks.filter(task => task.status !== "DONE" || task.cancelled);
      return tasks.length ? [{ ...table, tasks }] : [];
    });
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
