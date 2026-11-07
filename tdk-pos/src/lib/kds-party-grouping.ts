const cookOptionSignature = (options: Array<{ name: string }>) =>
  [...new Set(options.map(option => option.name.trim()).filter(Boolean))].sort().join("|");

/** Keep table sessions independent while placing members of a party in one card. */
export type KdsPartyTask = {
  sessionId: number;
  tableId?: number | null;
  orderId?: number;
  orderBundleKey?: string | null;
  orderedAtMs?: number;
  confirmedAtMs?: number;
  groupId: number | null;
  sessionKind: "DINE_IN" | "TAKEOUT_WALK_IN" | "TAKEOUT_PHONE";
  status: "WAITING" | "COOKING" | "DONE";
  cancelled: boolean;
  displayOnlyAsAddon?: boolean;
  cookSignature?: string;
  displayAddonItems?: Array<{
    itemId: number; name: string; qty: number; kind: "ADDON"; kdsKind: "ADDON";
    kdsGroupKey: string | null; completionTimer: boolean; note: string | null;
    options: Array<{ name: string; qty: number }>;
  }>;
  displayAddonTaskIds?: number[];
};

export type KdsTableGroup<T> = { sessionId: number; tasks: T[] };
export type KdsPartyCard<T> = { key: string; tables: KdsTableGroup<T>[] };

/** Attach a separately submitted add-on to one unambiguous, still-relevant pot in the same time bundle. */
export function attachKdsOrderBundleAddons<T extends KdsPartyTask & {
  taskId: number; confirmedAtMs: number; completedAtMs: number | null; compatibilityKey: string;
  completionRequestedAtMs?: number | null;
  completionRequestScope?: "TASK" | "TABLE" | null;
  completionRequestId?: string | null;
  kind: "POT" | "SOLO";
  items: Array<{ itemId: number; name: string; qty: number; kind: string; kdsKind: string;
    kdsGroupKey: string | null; completionTimer: boolean; note: string | null; options: Array<{ name: string; qty: number }> }>;
}>(source: T[], bundleWindowMs = 0): T[] {
  const tasks = source.map(task => ({ ...task, displayOnlyAsAddon: false, displayAddonItems: [] as NonNullable<KdsPartyTask["displayAddonItems"]>, displayAddonTaskIds: [] as number[] }));
  // orderBundleKey is a presentation key that can be promoted to a party key.
  // Add-on-to-pot matching must use only the physical table and fixed order-time
  // window, otherwise party grouping can either join unrelated time windows or
  // separate valid orders when party membership differs between sessions.
  const tableOrderBundles = bundleWindowMs > 0 ? buildKdsTableOrderBundleKeys(tasks, bundleWindowMs) : new Map<string, string>();
  for (const addon of tasks) {
    if (addon.kind !== "SOLO" || addon.cancelled ||
      (addon.status !== "WAITING" && addon.status !== "COOKING" && addon.status !== "DONE") ||
      addon.tableId == null || addon.orderId === undefined || !addon.items.length ||
      addon.items.some(item => item.kind === "COMPONENT" || item.kdsKind !== "ADDON")) continue;
    const addonBundleKey = tableOrderBundles.get(`${addon.tableId}:${addon.orderId}`);
    if (!addonBundleKey) continue;
    const groupKeys = [...new Set(addon.items.map(item => item.kdsGroupKey?.trim() || null))];
    if (groupKeys.length !== 1) continue;
    const groupKey = groupKeys[0];
    let candidates = tasks.filter(pot => pot.kind === "POT" && !pot.cancelled && pot.tableId === addon.tableId &&
      pot.orderId !== undefined && tableOrderBundles.get(`${pot.tableId}:${pot.orderId}`) === addonBundleKey &&
      (pot.completionRequestedAtMs == null || (addon.completionRequestedAtMs === pot.completionRequestedAtMs &&
        addon.completionRequestScope === pot.completionRequestScope && addon.completionRequestId === pot.completionRequestId)) &&
      pot.confirmedAtMs <= addon.confirmedAtMs &&
      (addon.status === "DONE"
        ? pot.status === "DONE" && pot.completedAtMs !== null && pot.completedAtMs >= addon.confirmedAtMs &&
          addon.completedAtMs !== null && pot.completedAtMs >= addon.completedAtMs
        : pot.status !== "DONE"));
    if (addon.status === "COOKING") candidates = candidates.filter(pot => pot.status === "COOKING");
    if (addon.status === "DONE") candidates = candidates.filter(pot => pot.status === "DONE" && addon.completedAtMs !== null &&
      pot.completedAtMs !== null && pot.completedAtMs >= addon.completedAtMs);
    if (groupKey !== null) {
      candidates = candidates.filter(pot => pot.compatibilityKey === groupKey);
    } else {
      const defaultGroup = candidates.some(pot => pot.compatibilityKey === "POT")
        ? candidates.filter(pot => pot.compatibilityKey === "POT")
        : new Set(candidates.map(pot => pot.compatibilityKey)).size === 1 ? candidates : [];
      candidates = defaultGroup;
    }
    const addonSignature = cookOptionSignature(addon.items.flatMap(item => item.options).map(option => ({ name: option.name })));
    if (addonSignature) candidates = candidates.filter(pot => pot.cookSignature === addonSignature);
    if (candidates.length !== 1) continue;
    const target = candidates[0];
    target.displayAddonItems.push(...addon.items.map(item => ({ ...item, kind: "ADDON" as const, kdsKind: "ADDON" as const })));
    target.displayAddonTaskIds.push(addon.taskId);
    addon.displayOnlyAsAddon = true;
  }
  return tasks;
}

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
  sessionId: number; orderId: number; orderBundleKey?: string | null; kind: "POT" | "SOLO"; sessionKind: KdsPartyTask["sessionKind"];
  compatibilityKey: string; cookSignature?: string; status: "WAITING" | "COOKING" | "DONE";
  startedAtMs: number | null; completedAtMs: number | null; changedAtMs?: number | null; completionRequestId: string | null;
  completionRequestScope: "TASK" | "TABLE" | null; completionRequestedAtMs: number | null; cancelled: boolean;
  displayOnlyAsAddon?: boolean;
  items: Array<{ name: string; kind: string; kdsKind?: string; kdsGroupKey?: string | null; options?: Array<{ name: string; qty: number }> }>;
}>(tasks: T[]): T[][] {
  const rows: T[][] = [];
  const keys = new Map<string, T[]>();
  for (const task of tasks) {
    if (task.kind !== "POT" || task.sessionKind !== "DINE_IN" || task.cancelled) continue;
    const orderBundleKey = task.orderBundleKey ?? String(task.orderId);
    const key = [task.sessionId, orderBundleKey, task.compatibilityKey, task.cookSignature ?? "", task.status, task.changedAtMs, task.startedAtMs, task.completedAtMs,
      task.completionRequestScope, task.completionRequestId, task.completionRequestedAtMs].join(":");
    let row = keys.get(key);
    if (!row) { row = []; keys.set(key, row); rows.push(row); }
    row.push(task);
  }
  const addons = tasks.filter(task => !task.displayOnlyAsAddon && task.kind === "SOLO" && task.sessionKind === "DINE_IN" && !task.cancelled &&
    task.items.some(item => item.kind !== "COMPONENT" && item.kdsKind === "ADDON"));
  for (const addon of addons) {
    const addonGroupKeys = [...new Set(addon.items
      .filter(item => item.kind !== "COMPONENT" && item.kdsKind === "ADDON")
      .map(item => item.kdsGroupKey?.trim() || null))];
    if (addonGroupKeys.length !== 1) continue;
    const addonGroupKey = addonGroupKeys[0];
    const addonSignature = cookOptionSignature(addon.items
      .filter(item => item.kind !== "COMPONENT" && item.kdsKind === "ADDON")
      .flatMap(item => item.options ?? []).map(option => ({ name: option.name })));
    const sameOrderPotRows = rows.filter(row => row[0].sessionId === addon.sessionId &&
      (row[0].orderBundleKey ?? String(row[0].orderId)) === (addon.orderBundleKey ?? String(addon.orderId)));
    let candidates = addonGroupKey !== null
      ? sameOrderPotRows.filter(row => row.some(pot => pot.compatibilityKey === addonGroupKey))
      : sameOrderPotRows.filter(row => row[0].compatibilityKey === "POT");
    if (addonGroupKey === null) {
      if (candidates.length === 0) {
        const groupKeys = new Set(sameOrderPotRows.map(row => row[0].compatibilityKey));
        if (groupKeys.size === 1) candidates = sameOrderPotRows;
      }
    }
    if (addonSignature) candidates = candidates.filter(row => (row[0].cookSignature ?? "") === addonSignature);
    candidates = candidates.filter(row => row.some(pot => pot.status === addon.status &&
      pot.startedAtMs === addon.startedAtMs && pot.completedAtMs === addon.completedAtMs &&
      pot.changedAtMs === addon.changedAtMs &&
      pot.completionRequestScope === addon.completionRequestScope &&
      pot.completionRequestId === addon.completionRequestId &&
      pot.completionRequestedAtMs === addon.completionRequestedAtMs));
    if (candidates.length === 1) candidates[0].push(addon);
  }
  const grouped = new Set(rows.flat());
  for (const task of tasks) if (!task.displayOnlyAsAddon && !grouped.has(task)) rows.push([task]);
  for (const row of rows) if (row.length > 1) row.sort((a, b) =>
    Number(b.items.some(item => item.kind === "POT" && item.name === "흑돼지김치찌개")) -
    Number(a.items.some(item => item.kind === "POT" && item.name === "흑돼지김치찌개")));
  return rows;
}

export function activeKdsTableTasks<T extends KdsPartyTask>(tasks: T[]) {
  return tasks.filter(task => !task.displayOnlyAsAddon && !task.cancelled && task.status !== "DONE");
}

export function oldestKdsTableOrderedAtMs<T extends KdsPartyTask & { orderedAtMs: number }>(tasks: T[], preparing: boolean) {
  const active = preparing ? activeKdsTableTasks(tasks) : [];
  return Math.min(...(active.length ? active : tasks).map(task => task.orderedAtMs));
}

type KdsOrderBundleSource = Pick<KdsPartyTask,
  "sessionId" | "tableId" | "orderId" | "confirmedAtMs" | "orderedAtMs" | "groupId" | "sessionKind">;

/** A fixed-anchor order-time bundle for one physical table, independent of party-card grouping. */
export function buildKdsTableOrderBundleKeys<T extends KdsOrderBundleSource>(tasks: T[], bundleWindowMs: number) {
  const ordersByTable = new Map<number, Map<number, number>>();
  for (const task of tasks) {
    if (task.sessionKind !== "DINE_IN" || task.tableId == null || task.orderId === undefined) continue;
    const at = Number.isFinite(task.confirmedAtMs) ? task.confirmedAtMs! : task.orderedAtMs;
    if (!Number.isFinite(at)) continue;
    const orders = ordersByTable.get(task.tableId) ?? new Map<number, number>();
    const previousAt = orders.get(task.orderId);
    if (previousAt === undefined || at! < previousAt) orders.set(task.orderId, at!);
    ordersByTable.set(task.tableId, orders);
  }

  const result = new Map<string, string>();
  for (const [tableId, orderTimes] of ordersByTable) {
    const orders = [...orderTimes].map(([orderId, at]) => ({ orderId, at }))
      .sort((a, b) => a.at - b.at || a.orderId - b.orderId);
    let anchorAt: number | null = null;
    let anchorOrderId: number | null = null;
    for (const order of orders) {
      if (anchorAt === null || order.at - anchorAt > bundleWindowMs) {
        anchorAt = order.at;
        anchorOrderId = order.orderId;
      }
      result.set(`${tableId}:${order.orderId}`, `table:${tableId}:bundle:${anchorOrderId}`);
    }
  }
  return result;
}

export function buildKdsOrderBundleKeys<T extends KdsOrderBundleSource>(tasks: T[], bundleWindowMs: number) {
  const result = buildKdsTableOrderBundleKeys(tasks, bundleWindowMs);
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const current = parent.get(key);
    if (!current) { parent.set(key, key); return key; }
    if (current === key) return key;
    const root = find(current);
    parent.set(key, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left); const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      const root = leftRoot < rightRoot ? leftRoot : rightRoot;
      parent.set(leftRoot, root); parent.set(rightRoot, root);
    }
  };
  const orderKeysByTask = new Map<T, string>();
  for (const task of tasks) {
    if (task.tableId == null || task.orderId === undefined) continue;
    const bundleKey = result.get(`${task.tableId}:${task.orderId}`);
    if (!bundleKey) continue;
    orderKeysByTask.set(task, bundleKey);
    find(bundleKey);
    if (task.sessionKind === "DINE_IN" && task.groupId !== null) union(bundleKey, `party:${task.groupId}`);
  }
  const partyKeyByRoot = new Map<string, string>();
  for (const task of tasks) {
    if (task.sessionKind !== "DINE_IN" || task.groupId === null) continue;
    const bundleKey = orderKeysByTask.get(task);
    if (!bundleKey) continue;
    const root = find(bundleKey);
    const partyKey = `party:${task.groupId}`;
    const existing = partyKeyByRoot.get(root);
    if (!existing || partyKey < existing) partyKeyByRoot.set(root, partyKey);
  }
  for (const [lookup, bundleKey] of result) {
    const root = find(bundleKey);
    result.set(lookup, partyKeyByRoot.get(root) ?? root);
  }
  return result;
}

function groupKdsTasks<T extends KdsPartyTask>(tasks: T[], bundleWindowMs: number, groupPhysicalTables: boolean): KdsPartyCard<T>[] {
  const orderBundles = !groupPhysicalTables && bundleWindowMs > 0
    ? buildKdsOrderBundleKeys(tasks, bundleWindowMs) : new Map<string, string>();
  const parentByPhysicalNode = new Map<string, string>();
  const ensureNode = (node: string) => { if (!parentByPhysicalNode.has(node)) parentByPhysicalNode.set(node, node); };
  const findRoot = (node: string): string => {
    ensureNode(node);
    const parent = parentByPhysicalNode.get(node)!;
    if (parent === node) return node;
    const root = findRoot(parent);
    parentByPhysicalNode.set(node, root);
    return root;
  };
  const unionNodes = (left: string, right: string) => {
    const leftRoot = findRoot(left);
    const rightRoot = findRoot(right);
    if (leftRoot !== rightRoot) parentByPhysicalNode.set(rightRoot, leftRoot);
  };
  for (const task of groupPhysicalTables ? tasks : []) {
    if (task.sessionKind !== "DINE_IN") continue;
    if (task.tableId != null) ensureNode(`table:${task.tableId}`);
    if (task.groupId !== null) ensureNode(`party:${task.groupId}`);
    if (task.tableId != null && task.groupId !== null) unionNodes(`table:${task.tableId}`, `party:${task.groupId}`);
  }
  const physicalNodeKeys = new Map<string, { parties: number[]; tables: number[] }>();
  for (const node of parentByPhysicalNode.keys()) {
    const root = findRoot(node);
    const component = physicalNodeKeys.get(root) ?? { parties: [], tables: [] };
    const [kind, id] = node.split(":");
    if (kind === "party") component.parties.push(Number(id));
    else component.tables.push(Number(id));
    physicalNodeKeys.set(root, component);
  }
  const cardKeyByPhysicalNode = new Map<string, string>();
  for (const [root, component] of physicalNodeKeys) {
    const key = component.parties.length ? `party:${Math.min(...component.parties)}` : `table:${Math.min(...component.tables)}`;
    cardKeyByPhysicalNode.set(root, key);
  }
  const cards = new Map<string, { card: KdsPartyCard<T>; tables: Map<number, KdsTableGroup<T>> }>();
  for (const task of tasks) {
    const physicalNode = task.tableId != null ? `table:${task.tableId}` : task.groupId !== null ? `party:${task.groupId}` : null;
    const key = groupPhysicalTables && task.sessionKind === "DINE_IN" && physicalNode !== null
      ? cardKeyByPhysicalNode.get(findRoot(physicalNode)) ?? physicalNode
      : task.orderBundleKey ?? (task.sessionKind === "DINE_IN" && task.groupId !== null
        ? `party:${task.groupId}`
        : orderBundles.get(`${task.tableId}:${task.orderId}`) ?? `session:${task.sessionId}`);
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

/** Legacy party/order-bundle grouping used by POS table-order and alert surfaces. */
export function groupKdsTasksByParty<T extends KdsPartyTask>(tasks: T[], bundleWindowMs = 0): KdsPartyCard<T>[] {
  return groupKdsTasks(tasks, bundleWindowMs, false);
}

/** KDS display grouping: one outer card per physical table, independent of order sessions and bundle windows. */
export function groupKdsKitchenTasks<T extends KdsPartyTask>(tasks: T[]): KdsPartyCard<T>[] {
  return groupKdsTasks(tasks, 0, true);
}

export function preparingKdsPartyCards<T extends KdsPartyTask>(cards: KdsPartyCard<T>[]): KdsPartyCard<T>[] {
  // Keep every table in a party card as context until all party tasks are done.
  // Filtering individual tables here made a completed member disappear too early.
  return cards.filter(card => partyHasActiveTask(card));
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
  card.tables.some(table => table.tasks.some(task => !task.displayOnlyAsAddon && (task.status !== "DONE" || task.cancelled)));

export function countKdsTablesByStatus<T extends KdsPartyTask>(cards: KdsPartyCard<T>[], status: "preparing" | "completed") {
  const countable = (task: T) => !task.displayOnlyAsAddon && !task.cancelled && (status === "preparing" ? task.status !== "DONE" : task.status === "DONE");
  const identities = new Set<number | string>();
  for (const card of cards) for (const table of card.tables) {
    if (!table.tasks.some(countable)) continue;
    const representative = table.tasks.find(countable)!;
    identities.add(representative.tableId ?? representative.sessionId);
  }
  return identities.size;
}
