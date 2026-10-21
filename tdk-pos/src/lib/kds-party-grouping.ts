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

export function activeKdsTableTasks<T extends KdsPartyTask>(tasks: T[]) {
  return tasks.filter(task => !task.cancelled && task.status !== "DONE");
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

export const partyHasActiveTask = <T extends KdsPartyTask>(card: KdsPartyCard<T>) =>
  card.tables.some(table => table.tasks.some(task => task.status !== "DONE" || task.cancelled));
