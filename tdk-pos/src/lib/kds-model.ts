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
export type KdsOrderBundleSettings = { enabled: boolean; minutes: number };
export const DEFAULT_KDS_ORDER_BUNDLE_SETTINGS: KdsOrderBundleSettings = { enabled: false, minutes: 3 };
export const KDS_ORDER_BUNDLE_MINUTES_RANGE = { min: 1, max: 60 } as const;
export function isKdsOrderBundleSettings(value: unknown): value is KdsOrderBundleSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<KdsOrderBundleSettings>;
  return typeof settings.enabled === "boolean" && typeof settings.minutes === "number" &&
    Number.isInteger(settings.minutes) && settings.minutes >= KDS_ORDER_BUNDLE_MINUTES_RANGE.min &&
    settings.minutes <= KDS_ORDER_BUNDLE_MINUTES_RANGE.max;
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

export function kdsCookOptionSignature(options: Array<{ name: string }>) {
  return [...new Set(options.map(option => option.name.trim()).filter(Boolean))].sort().join("|");
}

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
  cookOptionSignature?: string;
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
    const groupKey = pot.kdsGroupKey?.trim() || "POT";
    const key = `${groupKey}\u0000${pot.cookOptionSignature ?? ""}`;
    potGroups.set(key, [...(potGroups.get(key) ?? []), pot]);
  }
  const potGroupKeys = [...potGroups.entries()];
  const defaultPotGroupKey = potGroupKeys.some(([, group]) => (group[0].kdsGroupKey?.trim() || "POT") === "POT")
    ? "POT" : new Set(potGroupKeys.map(([, group]) => group[0].kdsGroupKey?.trim() || "POT")).size === 1
      ? potGroupKeys[0]?.[1][0].kdsGroupKey?.trim() || "POT" : null;
  const addonsByPot = new Map<string, KdsSourceItem[]>();
  for (const addon of addons) {
    const addonKey = addon.kdsGroupKey?.trim() || defaultPotGroupKey;
    if (!addonKey) continue;
    const candidates = potGroupKeys.filter(([, group]) => {
      const groupKey = group[0].kdsGroupKey?.trim() || "POT";
      return groupKey === addonKey && (addon.cookOptionSignature
        ? group[0].cookOptionSignature === addon.cookOptionSignature
        : true);
    });
    if (candidates.length !== 1) continue;
    const [potKey] = candidates[0];
    addonsByPot.set(potKey, [...(addonsByPot.get(potKey) ?? []), addon]);
  }
  for (const [potKey, group] of potGroupKeys) {
    const key = group[0].kdsGroupKey?.trim() || "POT";
    const first = group[0];
    const groupAddons = addonsByPot.get(potKey) ?? [];
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
export function canAcceptKdsQueuedUndo(
  delayFromFirstClickMs: unknown, changedAtMs: number | null, now: number, startUndoWindowMs = kdsStartUndoWindowMs(),
) {
  return typeof delayFromFirstClickMs === "number" && Number.isInteger(delayFromFirstClickMs) &&
    delayFromFirstClickMs >= 0 && delayFromFirstClickMs <= startUndoWindowMs &&
    changedAtMs !== null && now >= changedAtMs &&
    now - changedAtMs <= startUndoWindowMs + KDS_QUEUED_UNDO_TRANSPORT_GRACE_MS;
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
export function kdsCompletedElapsedSeconds(completedAtMs: number | null, nowMs: number) {
  if (completedAtMs === null || !Number.isFinite(completedAtMs) || completedAtMs <= 0 || !Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.floor((nowMs - completedAtMs) / 1_000));
}
export function kdsCompletedTimeShrinkStage(completedAtMs: number | null, nowMs: number, startMinutes: number) {
  const elapsed = kdsCompletedElapsedMinutes(completedAtMs, nowMs);
  if (elapsed === null || !isKdsCompletedTimeShrinkStartMinutes(startMinutes)) return 0;
  return Math.max(0, Math.min(5, elapsed - startMinutes));
}
/** Countdown color takes priority over cooking state and table card color. */
export function kdsTimeNumberColor(status: KdsTaskStatus, isDisplayedCountdown: boolean) {
  if (isDisplayedCountdown) return "#7C3AED";
  return status === "COOKING" ? "#2563EB" : "#111827";
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
export function kdsStartUndoWindowMs(completionCountdownSeconds: number = DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS) {
  return kdsCompletionCountdownMs(completionCountdownSeconds);
}
export function isKdsStartUndoWindowMs(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1000 && value <= MAX_KDS_COMPLETION_COUNTDOWN_SECONDS * 1000;
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
  previousStatus?: KdsTaskStatus | null; startSource?: "MENU" | "STATUS" | "TABLE" | null;
  startUndoWindowMs?: number | null;
  postCookTimerEligible?: boolean;
  completionRequestId?: string | null; completionRequestScope?: "TASK" | "TABLE" | null;
  completionRequestedAtMs?: number | null; taskId?: number; cancelled?: boolean;
};

/**
 * Build the client snapshot for a table completion request from persisted task rows,
 * not from display-only POT/add-on group rows. A selected POT action still uses its
 * explicit display group and adds only attached add-ons that belong to this session.
 */
export function buildKdsTableCompletionTaskSnapshot<T extends {
  taskId: number; sessionId: number; status: KdsTaskStatus; cancelled?: boolean;
  displayAddonTaskIds?: number[];
}>(sessionId: number, selectedTasks: T[], sessionTasks: T[], wholeSession: boolean) {
  const byId = new Map(sessionTasks.filter(task => task.sessionId === sessionId &&
    task.status === "COOKING" && !task.cancelled).map(task => [task.taskId, task]));
  if (wholeSession) return [...byId.values()];

  const selected = new Map(selectedTasks.filter(task => task.sessionId === sessionId &&
    task.status === "COOKING" && !task.cancelled).map(task => [task.taskId, task]));
  for (const task of selected.values()) for (const addonTaskId of task.displayAddonTaskIds ?? []) {
    const addon = byId.get(addonTaskId);
    if (addon) selected.set(addon.taskId, addon);
  }
  return [...selected.values()];
}

export const KDS_TABLE_DOUBLE_CLICK_WINDOW_MS = 300;
export function isKdsTableDoubleClick(firstTargetKey: string, firstClickAtMs: number,
  secondTargetKey: string, secondClickAtMs: number,
  windowMs = KDS_TABLE_DOUBLE_CLICK_WINDOW_MS) {
  const elapsed = secondClickAtMs - firstClickAtMs;
  return firstTargetKey.length > 0 && firstTargetKey === secondTargetKey &&
    Number.isFinite(firstClickAtMs) && Number.isFinite(secondClickAtMs) &&
    Number.isInteger(windowMs) && windowMs >= 0 && elapsed >= 0 && elapsed <= windowMs;
}

export function getKdsTableButtonAction(
  tasks: KdsTableButtonTask[], now: number, localBatchStartId?: string | null,
  defaultStartUndoWindowMs = kdsStartUndoWindowMs(), inputButton: "MENU" | "STATUS" | "TABLE" = "TABLE",
  postCookChoiceResolved = false,
) {
  const tableCompletion = tasks.find(task => !task.cancelled && task.completionRequestScope === "TABLE" && task.completionRequestId);
  if (tableCompletion?.completionRequestId) return inputButton === "STATUS" || inputButton === "TABLE"
    ? { action: "CANCEL_TABLE_COMPLETION" as const, requestId: tableCompletion.completionRequestId }
    : { action: "NOOP" as const };
  // A table tap during a task-scoped countdown is a cancel gesture. It must
  // take precedence over both the recent-start undo window and force-finalize.
  const taskCompletions = tasks.filter(task => !task.cancelled && task.status === "COOKING" &&
    task.completionRequestScope === "TASK" && task.completionRequestedAtMs !== null && task.completionRequestedAtMs !== undefined);
  if (taskCompletions.length && inputButton !== "MENU") return {
    action: "CANCEL_TASK_COMPLETIONS" as const,
    taskIds: taskCompletions.flatMap(task => task.taskId === undefined ? [] : [task.taskId]),
  };
  if (taskCompletions.length && inputButton === "MENU") return { action: "NOOP" as const };
  const recentBatch = tasks.filter(task => !task.cancelled && task.status === "COOKING" && task.bulkStartId &&
    task.changedAtMs !== null && now >= task.changedAtMs &&
    now - task.changedAtMs <= (task.startUndoWindowMs ?? defaultStartUndoWindowMs))
    .sort((a, b) => (b.changedAtMs ?? 0) - (a.changedAtMs ?? 0))[0];
  if (inputButton !== "TABLE") {
    const activeTask = tasks.find(task => !task.cancelled && task.status !== "DONE");
    if (!activeTask) return { action: "NOOP" as const };
    if (activeTask.status === "WAITING") return { action: "START" as const };
    const windowMs = activeTask.startUndoWindowMs ?? defaultStartUndoWindowMs;
    const recentlyStarted = activeTask.previousStatus === "WAITING" && activeTask.changedAtMs !== null &&
      now >= activeTask.changedAtMs && now - activeTask.changedAtMs <= windowMs;
    if (recentlyStarted && activeTask.startSource === inputButton) return { action: "UNDO_START" as const };
    if (inputButton === "MENU") return { action: "NOOP" as const };
    if (activeTask.postCookTimerEligible && !postCookChoiceResolved) return { action: "OPEN_POST_COOK_CHOICE" as const };
    return { action: "REQUEST_COMPLETION" as const };
  }
  // A fast second table tap advances the newly started batch to one table-wide
  // completion request. Individual buttons keep their same-button undo rule.
  if (recentBatch?.bulkStartId) return { action: "REQUEST_COMPLETION" as const };
  if (localBatchStartId) return { action: "REQUEST_COMPLETION" as const };
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
export function canUseKdsMenuAction(
  status: KdsTaskStatus, previousStatus: KdsTaskStatus | null, changedAtMs: number | null, now: number,
  startSource?: "MENU" | "STATUS" | "TABLE" | null, startUndoWindowMs = kdsStartUndoWindowMs(),
) {
  return status === "WAITING" || (status === "COOKING" && previousStatus === "WAITING" &&
    startSource === "MENU" && changedAtMs !== null && now >= changedAtMs && now - changedAtMs <= startUndoWindowMs);
}
export function canUndoKdsStatusStart(
  status: KdsTaskStatus, previousStatus: KdsTaskStatus | null, changedAtMs: number | null, now: number,
  startSource?: "MENU" | "STATUS" | "TABLE" | null, startUndoWindowMs = kdsStartUndoWindowMs(),
) {
  return status === "COOKING" && previousStatus === "WAITING" && startSource !== "TABLE" && startSource !== "MENU" &&
    changedAtMs !== null && now >= changedAtMs && now - changedAtMs <= startUndoWindowMs;
}
export type KdsIndividualButton = "MENU" | "STATUS";
export type KdsIndividualButtonIntent =
  | "START" | "UNDO_START" | "REQUEST_COMPLETE" | "CANCEL_COMPLETE"
  | "OPEN_POST_COOK_CHOICE" | "RESOLVE_POST_COOK_CHOICE"
  | "QUEUE_UNDO_START" | "QUEUE_COMPLETE_AFTER_START" | "QUEUE_STATUS_AFTER_START" | "NO_OP";
export type KdsIndividualButtonDecisionInput = {
  status: KdsTaskStatus;
  previousStatus: KdsTaskStatus | null;
  button: KdsIndividualButton;
  startSource?: "MENU" | "STATUS" | "TABLE" | null;
  startUndoWindowMs?: number;
  elapsedSinceStartMs?: number | null;
  pendingStartButton?: KdsIndividualButton | null;
  pendingStartElapsedMs?: number | null;
  startRequestPending?: boolean;
  completionRequested?: boolean;
  completionRequestPending?: boolean;
  requestInFlight?: boolean;
  completionFinalizePending?: boolean;
  tableCompletionPending?: boolean;
  cancelled?: boolean;
  postCookChoiceActive?: boolean;
  postCookTimerEligible?: boolean;
};

/** Only the opposite individual button may request completion inside the start-undo window. */
export function canRequestKdsTaskCompletionDuringStartWindow(
  startSource: "MENU" | "STATUS" | "TABLE" | null,
  completionInputButton: KdsIndividualButton | null | undefined,
) {
  return startSource === "MENU" && completionInputButton === "STATUS";
}

/**
 * Resolves individual menu/status button input. It only chooses an intent;
 * request serialization and authoritative state validation remain in the client/server.
 */
export function resolveKdsIndividualButtonIntent(input: KdsIndividualButtonDecisionInput): KdsIndividualButtonIntent {
  const {
    status, previousStatus, button, startSource = null, elapsedSinceStartMs = null,
    startUndoWindowMs = kdsStartUndoWindowMs(),
    pendingStartButton = null, pendingStartElapsedMs = null, startRequestPending = false,
    completionRequested = false, completionRequestPending = false, requestInFlight = false,
    completionFinalizePending = false, tableCompletionPending = false, cancelled = false,
    postCookChoiceActive = false, postCookTimerEligible = false,
  } = input;

  if (cancelled || status === "DONE" || completionFinalizePending || tableCompletionPending) return "NO_OP";

  if (startRequestPending && pendingStartButton !== null && pendingStartElapsedMs !== null) {
    if (!Number.isFinite(pendingStartElapsedMs) || pendingStartElapsedMs < 0) return "NO_OP";
    if (pendingStartElapsedMs <= startUndoWindowMs) {
      if (button === pendingStartButton) return "QUEUE_UNDO_START";
      // The center menu button only starts (or reverses its own very recent start).
      // It must not turn a status-button start into an implicit completion request.
      if (button === "MENU") return "NO_OP";
      return postCookTimerEligible ? "QUEUE_STATUS_AFTER_START" : "QUEUE_COMPLETE_AFTER_START";
    }
    return button === "STATUS" ? "QUEUE_STATUS_AFTER_START" : "NO_OP";
  }

  if (completionRequested || completionRequestPending) {
    return button === "STATUS" ? "CANCEL_COMPLETE" : "NO_OP";
  }
  if (requestInFlight) return "NO_OP";

  if (postCookChoiceActive) return button === "STATUS" ? "RESOLVE_POST_COOK_CHOICE" : "NO_OP";
  if (status === "WAITING") return "START";
  if (status !== "COOKING") return "NO_OP";

  const recentStart = previousStatus === "WAITING" && (startSource === "MENU" || startSource === "STATUS") &&
    elapsedSinceStartMs !== null && Number.isFinite(elapsedSinceStartMs) &&
    elapsedSinceStartMs >= 0 && elapsedSinceStartMs <= startUndoWindowMs;
  if (recentStart && startSource !== null) {
    if (button === startSource) return "UNDO_START";
    if (button === "MENU") return "NO_OP";
    return postCookTimerEligible ? "OPEN_POST_COOK_CHOICE" : "REQUEST_COMPLETE";
  }

  if (button === "MENU") return "NO_OP";
  return postCookTimerEligible ? "OPEN_POST_COOK_CHOICE" : "REQUEST_COMPLETE";
}
export function remainingKdsStartUndoSeconds(
  status: KdsTaskStatus, previousStatus: KdsTaskStatus | null, changedAtMs: number | null, now: number,
  startSource?: "MENU" | "STATUS" | "TABLE" | null, bulkStartId?: string | null, pendingTableStart = false,
  startUndoWindowMs = kdsStartUndoWindowMs(),
) {
  if (status !== "COOKING" || previousStatus !== "WAITING" || changedAtMs === null ||
    now < changedAtMs || now - changedAtMs > startUndoWindowMs) return null;
  const canUndo = canUseKdsMenuAction(status, previousStatus, changedAtMs, now, startSource, startUndoWindowMs) ||
    canUndoKdsStatusStart(status, previousStatus, changedAtMs, now, startSource, startUndoWindowMs) ||
    (startSource === "TABLE" && (Boolean(bulkStartId) || pendingTableStart));
  return canUndo ? Math.max(1, Math.ceil((changedAtMs + startUndoWindowMs - now) / 1000)) : null;
}
/** Uses the initiating device's monotonic clock so server clock resyncs cannot restart or flash the undo countdown. */
export function remainingKdsStartUndoSecondsFromClick(clickedAtMonoMs: number, nowMonoMs: number, startUndoWindowMs = kdsStartUndoWindowMs()) {
  const elapsedMs = nowMonoMs - clickedAtMonoMs;
  if (elapsedMs < 0 || elapsedMs > startUndoWindowMs) return null;
  return Math.max(1, Math.ceil((startUndoWindowMs - elapsedMs) / 1000));
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

export function needsNewCookingGroup(state: KdsState) {
  return state.status === "WAITING";
}

/** The previous snapshot is stored in DB so undo and redo survive refresh/restart. */
export function transitionKdsState(
  state: KdsState,
  action: "MENU" | "TIME",
  now: number,
  newGroup?: { groupId: number | null; startedAtMs: number },
  allowQueuedUndo = false,
  startUndoWindowMs = kdsStartUndoWindowMs(),
): KdsState | null {
  const previous = state.previousState;
  const recent = (action === "MENU"
    ? state.changedAtMs !== null && now >= state.changedAtMs && now - state.changedAtMs <= startUndoWindowMs
    : withinWindow(state, now)) || allowQueuedUndo;
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

/** Synchronize a separately persisted, display-attached add-on task with its pot action. */
export function transitionKdsLinkedAddonState(
  state: KdsState, action: "START" | "UNDO_START" | "COMPLETE" | "UNDO_COMPLETE", now: number,
  startUndoWindowMs = kdsStartUndoWindowMs(),
) {
  if (action === "START" && state.status === "WAITING") {
    return transitionKdsState(state, "MENU", now, { groupId: null, startedAtMs: now }, false, startUndoWindowMs);
  }
  if (action === "UNDO_START" && state.status === "COOKING" && state.previousState?.status === "WAITING") {
    return transitionKdsState(state, "MENU", now, undefined, false, startUndoWindowMs);
  }
  if (action === "COMPLETE" && state.status === "COOKING") {
    return transitionKdsState(state, "TIME", now);
  }
  if (action === "UNDO_COMPLETE" && state.status === "DONE" && state.previousState?.status === "COOKING") {
    return transitionKdsState(state, "TIME", now);
  }
  return null;
}
