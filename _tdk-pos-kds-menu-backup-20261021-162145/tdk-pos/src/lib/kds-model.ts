export type KdsMenuKind = "NONE" | "POT" | "ADDON" | "SOLO";
export type KdsTaskStatus = "WAITING" | "COOKING" | "DONE";
export const DEFAULT_KDS_BOIL_TIME_OPTIONS = [10, 5, 3] as const;
export const DEFAULT_KDS_BOIL_TIME_MINUTES = 5;
export const KDS_POST_COOK_TIMER_MINUTES_RANGE = { min: 1, max: 60 } as const;
export type KdsPostCookTimerMinutes = number;
export const isKdsPostCookTimerMinutes = (value: unknown): value is KdsPostCookTimerMinutes =>
  typeof value === "number" && Number.isInteger(value) &&
  value >= KDS_POST_COOK_TIMER_MINUTES_RANGE.min && value <= KDS_POST_COOK_TIMER_MINUTES_RANGE.max;
export type KdsCookingSettings = { boilTimeOptions: [number, number, number]; defaultBoilTimeMinutes: number };
export const DEFAULT_KDS_COOKING_SETTINGS: KdsCookingSettings = {
  boilTimeOptions: [...DEFAULT_KDS_BOIL_TIME_OPTIONS],
  defaultBoilTimeMinutes: DEFAULT_KDS_BOIL_TIME_MINUTES,
};
export function isKdsCookingSettings(value: unknown): value is KdsCookingSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<KdsCookingSettings>;
  return Array.isArray(settings.boilTimeOptions) && settings.boilTimeOptions.length === 3 &&
    settings.boilTimeOptions.every(isKdsPostCookTimerMinutes) && new Set(settings.boilTimeOptions).size === 3 &&
    isKdsPostCookTimerMinutes(settings.defaultBoilTimeMinutes) && settings.boilTimeOptions.includes(settings.defaultBoilTimeMinutes);
}
export type KdsMemberKind = "POT" | "ADDON" | "SOLO" | "COMPONENT";
export type KdsMember = { itemId: number; kind: KdsMemberKind };

export type KdsSourceItem = {
  itemId: number;
  parentItemId: number | null;
  menuId: number;
  itemType: "NORMAL" | "COMPONENT" | "SERVICE";
  kdsKind: KdsMenuKind;
  kdsGroupKey: string | null;
  kdsCompletionTimer: boolean;
  printOnKitchen: boolean;
  kdsVisible: boolean;
};

export function isKdsMenuEligible(item: Pick<KdsSourceItem, "kdsKind" | "kdsVisible">) {
  return item.kdsKind !== "NONE" && item.kdsVisible;
}

export type KdsTaskDraft = {
  orderId: number;
  taskKey: string;
  members: KdsMember[];
  kind: "POT" | "SOLO";
  compatibilityKey: string;
  completionTimer: boolean;
};

/** An order row is one POS order batch. Add-ons only join a pot in that batch. */
export function buildKdsTaskDrafts(orderId: number, source: KdsSourceItem[]): KdsTaskDraft[] {
  const items = [...source].sort((a, b) => a.itemId - b.itemId);
  const parents = items.filter(item => item.parentItemId === null && item.printOnKitchen && isKdsMenuEligible(item));
  const pots = parents.filter(item => item.kdsKind === "POT");
  const addons = parents.filter(item => item.kdsKind === "ADDON");
  const drafts: KdsTaskDraft[] = [];
  const potGroups = new Map<string, KdsSourceItem[]>();
  for (const pot of pots) {
    const key = pot.kdsGroupKey?.trim() || "POT";
    potGroups.set(key, [...(potGroups.get(key) ?? []), pot]);
  }
  for (const [key, group] of potGroups) {
    const first = group[0];
    const groupAddons = addons.filter(addon =>
      addon.kdsGroupKey?.trim() ? addon.kdsGroupKey.trim() === key : first === pots[0]);
    drafts.push({
      orderId,
      taskKey: `pot:${orderId}:${first.itemId}`,
      members: [...group.map(item => ({ itemId: item.itemId, kind: "POT" as const })),
        ...groupAddons.map(item => ({ itemId: item.itemId, kind: "ADDON" as const }))].sort((a, b) => a.itemId - b.itemId),
      kind: "POT",
      compatibilityKey: key,
      completionTimer: group.some(item => item.kdsCompletionTimer),
    });
  }
  for (const item of parents) {
    if (item.kdsKind === "POT" || (item.kdsKind === "ADDON" && drafts.some(task => task.members.some(member => member.itemId === item.itemId)))) continue;
    drafts.push({
      orderId,
      taskKey: `item:${item.itemId}`,
      members: [{ itemId: item.itemId, kind: item.kdsKind === "ADDON" ? "ADDON" : "SOLO" }],
      kind: "SOLO",
      compatibilityKey: item.kdsGroupKey?.trim() ? `SOLO:${item.kdsGroupKey.trim()}` : `MENU:${item.menuId}`,
      completionTimer: item.kdsCompletionTimer,
    });
  }
  // A component is subordinate to its parent task, but its own display switch
  // still decides whether it appears on the kitchen screen.
  for (const component of items.filter(item => item.parentItemId !== null && item.printOnKitchen && isKdsMenuEligible(item))) {
    const draft = drafts.find(task => task.members.some(member => member.itemId === component.parentItemId));
    if (draft) draft.members.push({ itemId: component.itemId, kind: "COMPONENT" });
  }
  const memberRank = { POT: 0, SOLO: 0, ADDON: 1, COMPONENT: 2 };
  for (const draft of drafts) draft.members.sort((a, b) => memberRank[a.kind] - memberRank[b.kind] || a.itemId - b.itemId);
  return drafts.sort((a, b) => a.members[0].itemId - b.members[0].itemId);
}

export type KdsStateSnapshot = {
  status: KdsTaskStatus;
  cookingGroupId: number | null;
  cookingStartedAtMs: number | null;
  cookingCompletedAtMs: number | null;
};
export type KdsState = KdsStateSnapshot & {
  previousState: KdsStateSnapshot | null;
  changedAtMs: number | null;
};
export const KDS_WINDOW_MS = 3000;
export const KDS_COMPLETION_COUNTDOWN_MS = 5000;
export function canJoinKdsCookingGroup(lastMenuStartAtMs: number, now: number) {
  return now >= lastMenuStartAtMs && now - lastMenuStartAtMs <= KDS_WINDOW_MS;
}
export function remainingKdsCompletionSeconds(requestedAtMs: number, now: number) {
  const elapsedSeconds = Math.floor(Math.max(0, now - requestedAtMs) / 1000);
  return Math.min(5, Math.max(1, Math.floor(KDS_COMPLETION_COUNTDOWN_MS / 1000) - elapsedSeconds));
}
export type KdsTableButtonTask = {
  status: KdsTaskStatus; changedAtMs: number | null; bulkStartId?: string | null;
  completionRequestId?: string | null; completionRequestScope?: "TASK" | "TABLE" | null; cancelled?: boolean;
};
export function getKdsTableButtonAction(tasks: KdsTableButtonTask[], now: number, localBatchStartId?: string | null) {
  const recentBatch = tasks.filter(task => !task.cancelled && task.status === "COOKING" && task.bulkStartId &&
    task.changedAtMs !== null && now >= task.changedAtMs && now - task.changedAtMs <= KDS_WINDOW_MS)
    .sort((a, b) => (b.changedAtMs ?? 0) - (a.changedAtMs ?? 0))[0];
  if (recentBatch?.bulkStartId) return { action: "UNDO_START" as const, batchStartId: recentBatch.bulkStartId };
  if (localBatchStartId) return { action: "UNDO_START" as const, batchStartId: localBatchStartId };
  const tableCompletion = tasks.find(task => !task.cancelled && task.completionRequestScope === "TABLE" && task.completionRequestId);
  if (tableCompletion?.completionRequestId) return { action: "CANCEL_COMPLETION" as const, requestId: tableCompletion.completionRequestId };
  if (tasks.some(task => !task.cancelled && task.status === "COOKING")) return { action: "REQUEST_COMPLETION" as const };
  if (tasks.some(task => !task.cancelled && task.status === "WAITING")) return { action: "START" as const };
  return { action: "NOOP" as const };
}
export function canUseKdsMenuAction(status: KdsTaskStatus, previousStatus: KdsTaskStatus | null, changedAtMs: number | null, now: number, startSource?: "MENU" | "STATUS" | "TABLE" | null) {
  return status === "WAITING" || (status === "COOKING" && previousStatus === "WAITING" &&
    startSource !== "TABLE" && startSource !== "STATUS" && changedAtMs !== null && now >= changedAtMs && now - changedAtMs <= KDS_WINDOW_MS);
}
export function canUndoKdsStatusStart(status: KdsTaskStatus, previousStatus: KdsTaskStatus | null, changedAtMs: number | null, now: number, startSource?: "MENU" | "STATUS" | "TABLE" | null) {
  return status === "COOKING" && previousStatus === "WAITING" && startSource !== "TABLE" && startSource !== "MENU" &&
    changedAtMs !== null && now >= changedAtMs && now - changedAtMs <= KDS_WINDOW_MS;
}
export function remainingKdsQuantity(originalQty: number, cancelledQty: number, cancelled: boolean) {
  return cancelled ? 0 : Math.max(0, originalQty - cancelledQty);
}
const snapshot = (state: KdsState): KdsStateSnapshot => ({
  status: state.status,
  cookingGroupId: state.cookingGroupId,
  cookingStartedAtMs: state.cookingStartedAtMs,
  cookingCompletedAtMs: state.cookingCompletedAtMs,
});
const withinWindow = (state: KdsState, now: number) =>
  state.changedAtMs !== null && now >= state.changedAtMs && now - state.changedAtMs <= KDS_WINDOW_MS;

export function needsNewCookingGroup(state: KdsState, now: number) {
  return state.status === "WAITING";
}

/** The previous snapshot is stored in DB so undo and redo survive refresh/restart. */
export function transitionKdsState(
  state: KdsState,
  action: "MENU" | "TIME",
  now: number,
  newGroup?: { groupId: number | null; startedAtMs: number },
): KdsState | null {
  const previous = state.previousState;
  const recent = withinWindow(state, now);
  let next: KdsStateSnapshot | null = null;
  if (action === "MENU" && state.status === "WAITING") {
    if (newGroup) next = { status: "COOKING", cookingGroupId: newGroup.groupId, cookingStartedAtMs: newGroup.startedAtMs, cookingCompletedAtMs: null };
  } else if (action === "MENU" && state.status === "COOKING" && recent && previous?.status === "WAITING") {
    next = previous;
  } else if (action === "TIME" && state.status === "COOKING") {
    next = recent && previous?.status === "DONE"
      ? previous
      : { ...snapshot(state), status: "DONE", cookingCompletedAtMs: now };
  } else if (action === "TIME" && state.status === "DONE" && recent && (previous?.status === "COOKING" || previous?.status === "WAITING")) {
    next = previous;
  }
  return next ? { ...next, previousState: snapshot(state), changedAtMs: now } : null;
}
