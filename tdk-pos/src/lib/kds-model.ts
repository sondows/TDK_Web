export type KdsMenuKind = "NONE" | "POT" | "ADDON" | "SOLO";
export type KdsTaskStatus = "WAITING" | "COOKING" | "DONE";
export const DEFAULT_KDS_BOIL_TIME_OPTIONS = [10, 5, 3] as const;
export const DEFAULT_KDS_BOIL_TIME_MINUTES = 5;
export const KDS_POST_COOK_TIMER_MINUTES_RANGE = { min: 1, max: 60 } as const;
export type KdsPostCookTimerMinutes = number;
export const isKdsPostCookTimerMinutes = (value: unknown): value is KdsPostCookTimerMinutes =>
  typeof value === "number" && Number.isInteger(value) &&
  value >= KDS_POST_COOK_TIMER_MINUTES_RANGE.min && value <= KDS_POST_COOK_TIMER_MINUTES_RANGE.max;
export const isKdsSelectedPotTasks = (value: unknown): value is boolean | undefined =>
  value === undefined || typeof value === "boolean";
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
export type KdsMember = { itemId: number; kind: KdsMemberKind; completionTimer?: boolean };

/** A shared pot has one status control, while each cooked menu keeps its own display setting. */
export function kdsCompletedTimerDisplay(items: Array<{ name: string; kind: KdsMemberKind; completionTimer: boolean }>, kind: "POT" | "SOLO") {
  const cookedItems = items.filter(item => item.kind === "POT" || item.kind === "SOLO" || (kind === "SOLO" && item.kind === "ADDON"));
  const enabledNames = [...new Set(cookedItems.filter(item => item.completionTimer).map(item => item.name))];
  return { enabledNames, mixed: enabledNames.length > 0 && cookedItems.some(item => !item.completionTimer) };
}

export type KdsDisplayItem = {
  name: string; qty: number; kind: KdsMemberKind;
  options: Array<{ name: string; qty: number }>;
};

/** Format only members already assigned to one persisted KDS task. */
export function formatKdsTaskDisplay(kind: "POT" | "SOLO", items: KdsDisplayItem[]) {
  const primary = items.find(item => item.kind === "POT" || item.kind === "SOLO") ??
    items.find(item => item.kind !== "COMPONENT");
  if (!primary) return { name: "주문 항목", qty: 0, details: [] as string[] };
  const qty = kind === "POT"
    ? items.filter(item => item.kind === "POT" && item.name === primary.name).reduce((sum, item) => sum + item.qty, 0)
    : primary.qty;
  const members = new Map<string, { qty: number; kind: KdsMemberKind }>();
  for (const item of items) {
    if (item === primary || (kind === "POT" && item.kind === "POT" && item.name === primary.name)) continue;
    members.set(item.name, { qty: (members.get(item.name)?.qty ?? 0) + item.qty, kind: item.kind });
  }
  const options = new Map<string, number>();
  for (const item of items) for (const option of item.options) {
    if (/(?:매운맛|순한맛|안매움)/.test(option.name) || members.has(option.name)) continue;
    options.set(option.name, (options.get(option.name) ?? 0) + option.qty);
  }
  const details = [
    ...[...members].map(([name, member]) => member.kind === "POT"
      ? `${name}${member.qty > 1 ? member.qty : ""}` : member.qty > 1 ? `${name} ×${member.qty}` : name),
    ...[...options].map(([name, count]) => count > 1 ? `${name} ×${count}` : name),
  ];
  return { name: primary.name, qty, details };
}

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
      members: [...group.map(item => ({ itemId: item.itemId, kind: "POT" as const, completionTimer: item.kdsCompletionTimer })),
        ...groupAddons.map(item => ({ itemId: item.itemId, kind: "ADDON" as const, completionTimer: item.kdsCompletionTimer }))].sort((a, b) => a.itemId - b.itemId),
      kind: "POT",
      compatibilityKey: key,
      // Retain the task-level flag for older readers; member snapshots control the display.
      completionTimer: group.some(item => item.kdsCompletionTimer),
    });
  }
  for (const item of parents) {
    if (item.kdsKind === "POT" || (item.kdsKind === "ADDON" && drafts.some(task => task.members.some(member => member.itemId === item.itemId)))) continue;
    drafts.push({
      orderId,
      taskKey: `item:${item.itemId}`,
      members: [{ itemId: item.itemId, kind: item.kdsKind === "ADDON" ? "ADDON" : "SOLO", completionTimer: item.kdsCompletionTimer }],
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
export const KDS_QUEUED_UNDO_TRANSPORT_GRACE_MS = 4000;
export function canAcceptKdsQueuedUndo(delayFromFirstClickMs: unknown, changedAtMs: number | null, now: number) {
  return typeof delayFromFirstClickMs === "number" && Number.isInteger(delayFromFirstClickMs) &&
    delayFromFirstClickMs >= 0 && delayFromFirstClickMs <= KDS_WINDOW_MS &&
    changedAtMs !== null && now >= changedAtMs &&
    now - changedAtMs <= KDS_WINDOW_MS + KDS_QUEUED_UNDO_TRANSPORT_GRACE_MS;
}
export const DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS = 5;
export const DEFAULT_KDS_COMPLETED_TIME_SHRINK_START_MINUTES = 10;
export function isKdsCompletedTimeShrinkStartMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 120;
}
export function kdsCompletedElapsedMinutes(completedAtMs: number | null, nowMs: number) {
  if (completedAtMs === null || !Number.isFinite(completedAtMs) || completedAtMs <= 0 || !Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.floor((nowMs - completedAtMs) / 60_000));
}
export function kdsCompletedTimeShrinkStage(completedAtMs: number | null, nowMs: number, startMinutes: number) {
  const elapsed = kdsCompletedElapsedMinutes(completedAtMs, nowMs);
  if (elapsed === null || !isKdsCompletedTimeShrinkStartMinutes(startMinutes)) return 0;
  return Math.max(0, Math.min(5, elapsed - startMinutes));
}
/** Countdown color takes priority over cooking state and table card color. */
export function kdsTimeNumberColor(status: KdsTaskStatus, isDisplayedCountdown: boolean) {
  if (isDisplayedCountdown) return "#7C3AED";
  return status === "WAITING" ? "#111827" : "#2563EB";
}
export const MIN_KDS_COMPLETION_COUNTDOWN_SECONDS = 1;
export const MAX_KDS_COMPLETION_COUNTDOWN_SECONDS = 30;
export const KDS_COMPLETION_COUNTDOWN_MS = DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS * 1000;
// Keep the cancellation window open briefly after the visible countdown so a tap near zero
// can reach the server before any client or refresh-triggered finalizer commits completion.
export const KDS_TABLE_COMPLETION_FINALIZE_GRACE_MS = 1000;
// A cancel tap can arrive just after another KDS client commits the same table completion.
// Keep a short server-side rollback window for that exact request to resolve the race safely.
export const KDS_TABLE_COMPLETION_LATE_CANCEL_RECOVERY_MS = 5000;
export function isKdsCompletionCountdownSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) &&
    value >= MIN_KDS_COMPLETION_COUNTDOWN_SECONDS && value <= MAX_KDS_COMPLETION_COUNTDOWN_SECONDS;
}
export function kdsCompletionCountdownMs(seconds: number = DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS) {
  return (isKdsCompletionCountdownSeconds(seconds) ? seconds : DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS) * 1000;
}
export function canJoinKdsCookingGroup(lastMenuStartAtMs: number, now: number) {
  return now >= lastMenuStartAtMs && now - lastMenuStartAtMs <= KDS_WINDOW_MS;
}
export type KdsRecentMenuGroup = {
  groupId: number; startedAtMs: number; lastStartAtMs: number;
  startSource: "MENU" | "STATUS" | "TABLE" | null;
  previousStatus: KdsTaskStatus | null; completionPending: boolean;
};
export function findKdsRecentMenuGroup(candidates: KdsRecentMenuGroup[], now: number) {
  return candidates
    .filter(candidate => candidate.startSource === "MENU" && candidate.previousStatus === "WAITING" &&
      !candidate.completionPending && canJoinKdsCookingGroup(candidate.lastStartAtMs, now))
    .sort((a, b) => b.lastStartAtMs - a.lastStartAtMs || b.groupId - a.groupId)[0] ?? null;
}
export function remainingKdsCompletionSeconds(requestedAtMs: number, now: number, countdownSeconds = DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS) {
  const elapsedSeconds = Math.floor(Math.max(0, now - requestedAtMs) / 1000);
  const durationSeconds = isKdsCompletionCountdownSeconds(countdownSeconds) ? countdownSeconds : DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS;
  return Math.min(durationSeconds, Math.max(1, durationSeconds - elapsedSeconds));
}
export function kdsTableCompletionFinalizeAtMs(requestedAtMs: number, countdownSeconds = DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS) {
  const durationSeconds = isKdsCompletionCountdownSeconds(countdownSeconds) ? countdownSeconds : DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS;
  return requestedAtMs + durationSeconds * 1000 + KDS_TABLE_COMPLETION_FINALIZE_GRACE_MS;
}
export function canCancelKdsTableCompletion(requestedAtMs: number, now: number, countdownSeconds = DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS) {
  return now < kdsTableCompletionFinalizeAtMs(requestedAtMs, countdownSeconds);
}
export function canFinalizeKdsTableCompletion(requestedAtMs: number, now: number, countdownSeconds = DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS) {
  return now >= kdsTableCompletionFinalizeAtMs(requestedAtMs, countdownSeconds);
}
export function canRecoverKdsTableCompletionCancellation(completedAtMs: number, nowMs: number) {
  return nowMs >= completedAtMs && nowMs - completedAtMs <= KDS_TABLE_COMPLETION_LATE_CANCEL_RECOVERY_MS;
}
export async function honorQueuedKdsTableCompletionCancel<T>(
  request: Promise<T>, cancelRequested: () => boolean, cancel: (result: T) => Promise<void>,
) {
  const result = await request;
  if (!cancelRequested()) return { result, cancelled: false } as const;
  await cancel(result);
  return { result, cancelled: true } as const;
}
export type KdsTableButtonTask = {
  status: KdsTaskStatus; changedAtMs: number | null; bulkStartId?: string | null;
  completionRequestId?: string | null; completionRequestScope?: "TASK" | "TABLE" | null;
  completionRequestedAtMs?: number | null; taskId?: number; cancelled?: boolean;
};
export function getKdsTableButtonAction(tasks: KdsTableButtonTask[], now: number, localBatchStartId?: string | null) {
  const tableCompletion = tasks.find(task => !task.cancelled && task.completionRequestScope === "TABLE" && task.completionRequestId);
  if (tableCompletion?.completionRequestId) return { action: "CANCEL_TABLE_COMPLETION" as const, requestId: tableCompletion.completionRequestId };
  // A table tap during a task-scoped countdown is a cancel gesture. It must
  // take precedence over both the recent-start undo window and force-finalize.
  const taskCompletions = tasks.filter(task => !task.cancelled && task.status === "COOKING" &&
    task.completionRequestScope === "TASK" && task.completionRequestedAtMs !== null && task.completionRequestedAtMs !== undefined);
  if (taskCompletions.length) return {
    action: "CANCEL_TASK_COMPLETIONS" as const,
    taskIds: taskCompletions.flatMap(task => task.taskId === undefined ? [] : [task.taskId]),
  };
  const recentBatch = tasks.filter(task => !task.cancelled && task.status === "COOKING" && task.bulkStartId &&
    task.changedAtMs !== null && now >= task.changedAtMs && now - task.changedAtMs <= KDS_WINDOW_MS)
    .sort((a, b) => (b.changedAtMs ?? 0) - (a.changedAtMs ?? 0))[0];
  if (recentBatch?.bulkStartId) return { action: "UNDO_START" as const, batchStartId: recentBatch.bulkStartId };
  if (localBatchStartId) return { action: "UNDO_START" as const, batchStartId: localBatchStartId };
  if (tasks.some(task => !task.cancelled && task.status === "COOKING")) return { action: "REQUEST_COMPLETION" as const };
  if (tasks.some(task => !task.cancelled && task.status === "WAITING")) return { action: "START" as const };
  return { action: "NOOP" as const };
}
export function clearCancelledKdsTableCompletionRequests<T extends {
  sessionId: number;
  completionRequestId: string | null;
  completionRequestScope: "TASK" | "TABLE" | null;
  completionRequestedAtMs: number | null;
  completionCountdownSeconds?: number | null;
  pendingPostCookTimerMinutes?: number | null;
}>(tasks: T[], cancelledRequestKeys: ReadonlySet<string>) {
  return tasks.map(task => task.completionRequestScope === "TABLE" && task.completionRequestId &&
    cancelledRequestKeys.has(`${task.sessionId}:${task.completionRequestId}`)
    ? { ...task, completionRequestedAtMs: null, completionRequestId: null, completionRequestScope: null,
        completionCountdownSeconds: null, pendingPostCookTimerMinutes: null } as T
    : task);
}
/** Clear each task's scheduled finalizer before sending its matching cancel request. */
export async function cancelKdsTaskCompletionRequests<T extends { taskId: number }>(
  tasks: T[], cancelRequest: (task: T) => Promise<void>, clearTimer: (taskId: number) => void,
) {
  for (const task of tasks) clearTimer(task.taskId);
  await Promise.all(tasks.map(cancelRequest));
}
export function matchesKdsTableStartBatch(expectedTaskIds: number[], actualTaskIds: number[]) {
  if (!expectedTaskIds.length || expectedTaskIds.length !== actualTaskIds.length ||
    new Set(expectedTaskIds).size !== expectedTaskIds.length || new Set(actualTaskIds).size !== actualTaskIds.length) return false;
  const expected = expectedTaskIds.slice().sort((a, b) => a - b);
  const actual = actualTaskIds.slice().sort((a, b) => a - b);
  return expected.every((taskId, index) => taskId === actual[index]);
}
export function canUseKdsMenuAction(status: KdsTaskStatus, previousStatus: KdsTaskStatus | null, changedAtMs: number | null, now: number, startSource?: "MENU" | "STATUS" | "TABLE" | null) {
  return status === "WAITING" || (status === "COOKING" && previousStatus === "WAITING" &&
    startSource === "MENU" && changedAtMs !== null && now >= changedAtMs && now - changedAtMs <= KDS_WINDOW_MS);
}
export function canUndoKdsStatusStart(status: KdsTaskStatus, previousStatus: KdsTaskStatus | null, changedAtMs: number | null, now: number, startSource?: "MENU" | "STATUS" | "TABLE" | null) {
  return status === "COOKING" && previousStatus === "WAITING" && startSource !== "TABLE" && startSource !== "MENU" &&
    changedAtMs !== null && now >= changedAtMs && now - changedAtMs <= KDS_WINDOW_MS;
}
export function remainingKdsStartUndoSeconds(
  status: KdsTaskStatus, previousStatus: KdsTaskStatus | null, changedAtMs: number | null, now: number,
  startSource?: "MENU" | "STATUS" | "TABLE" | null, bulkStartId?: string | null, pendingTableStart = false,
) {
  if (status !== "COOKING" || previousStatus !== "WAITING" || changedAtMs === null ||
    now < changedAtMs || now - changedAtMs > KDS_WINDOW_MS) return null;
  const canUndo = canUseKdsMenuAction(status, previousStatus, changedAtMs, now, startSource) ||
    canUndoKdsStatusStart(status, previousStatus, changedAtMs, now, startSource) ||
    (startSource === "TABLE" && (Boolean(bulkStartId) || pendingTableStart));
  return canUndo ? Math.max(1, Math.ceil((changedAtMs + KDS_WINDOW_MS - now) / 1000)) : null;
}
/** Uses the initiating device's monotonic clock so server clock resyncs cannot restart or flash the undo countdown. */
export function remainingKdsStartUndoSecondsFromClick(clickedAtMonoMs: number, nowMonoMs: number) {
  const elapsedMs = nowMonoMs - clickedAtMonoMs;
  if (elapsedMs < 0 || elapsedMs > KDS_WINDOW_MS) return null;
  return Math.max(1, Math.ceil((KDS_WINDOW_MS - elapsedMs) / 1000));
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
  allowQueuedUndo = false,
): KdsState | null {
  const previous = state.previousState;
  const recent = withinWindow(state, now) || allowQueuedUndo;
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
