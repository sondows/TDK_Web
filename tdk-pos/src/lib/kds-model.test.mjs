import assert from "node:assert/strict";
import test from "node:test";
import { canRecoverKdsTableCompletionCancellation, honorQueuedKdsTableCompletionCancel } from "./kds-model.ts";
import { parseKdsMenuConfig } from "./kds-menu-config.ts";
import { buildKdsTaskDrafts, canAcceptKdsQueuedUndo, canCancelKdsTableCompletion, canFinalizeKdsTableCompletion, canJoinKdsCookingGroup, canUndoKdsStatusStart, canUseKdsMenuAction, cancelKdsTaskCompletionRequests, clearCancelledKdsTableCompletionRequests, DEFAULT_KDS_COOKING_SETTINGS, findKdsRecentMenuGroup, formatKdsTaskDisplay, getKdsTableButtonAction, isKdsCompletionCountdownSeconds, isKdsCompletedTimeShrinkStartMinutes, isKdsCookingSettings, isKdsPostCookTimerMinutes, isKdsSelectedPotTasks, kdsCompletedElapsedMinutes, kdsCompletedTimeShrinkStage, kdsCompletedTimerDisplay, kdsTableCompletionFinalizeAtMs, kdsTimeNumberColor, matchesKdsTableStartBatch, needsNewCookingGroup, remainingKdsCompletionSeconds, remainingKdsQuantity, remainingKdsStartUndoSeconds, remainingKdsStartUndoSecondsFromClick, transitionKdsState } from "./kds-model.ts";

const item = (itemId, kdsKind, overrides = {}) => ({
  itemId, parentItemId: null, menuId: itemId, itemType: "NORMAL",
  kdsKind, kdsGroupKey: null, kdsCompletionTimer: false, printOnKitchen: true, kdsVisible: true,
  ...overrides,
});
const waiting = { status: "WAITING", cookingGroupId: null, cookingStartedAtMs: null,
  cookingCompletedAtMs: null, previousState: null, changedAtMs: null };

test("menu configuration preserves explicit completion elapsed display OFF", () => {
  for (const off of [false, "false", 0]) {
    assert.equal(parseKdsMenuConfig("SOLO", null, off)?.kdsCompletionTimer, false);
  }
  assert.equal(parseKdsMenuConfig("SOLO", null, true)?.kdsCompletionTimer, true);
  assert.equal(parseKdsMenuConfig("SOLO", null, undefined), null);
});

test("KDS waiting, elapsed, and active countdown numbers use their own colors", () => {
  assert.equal(kdsTimeNumberColor("WAITING", false), "#111827");
  assert.equal(kdsTimeNumberColor("WAITING", true), "#7C3AED");
  assert.equal(kdsTimeNumberColor("COOKING", false), "#2563EB");
  assert.equal(kdsTimeNumberColor("COOKING", true), "#7C3AED");
  assert.equal(kdsTimeNumberColor("DONE", false), "#111827");
});

test("one persisted pot task keeps each stew's servings and real components once", () => {
  const view = formatKdsTaskDisplay("POT", [
    { name: "흑돼지김치찌개", qty: 1, kind: "POT", options: [] },
    { name: "목살김치찌개", qty: 1, kind: "POT", options: [{ name: "목살추가", qty: 1 }] },
    { name: "목살추가", qty: 1, kind: "ADDON", options: [] },
  ]);
  assert.deepEqual(view, { name: "흑돼지김치찌개", qty: 1,
    details: ["목살김치찌개", "목살추가"] });
});

test("stew detail omits one serving, shows larger serving counts, and leaves addon counts unchanged", () => {
  assert.deepEqual(formatKdsTaskDisplay("POT", [
    { name: "흑돼지김치찌개", qty: 2, kind: "POT", options: [] },
    { name: "불고기김치찌개", qty: 1, kind: "POT", options: [] },
    { name: "참치김치찌개", qty: 3, kind: "POT", options: [] },
    { name: "두부추가", qty: 2, kind: "ADDON", options: [] },
  ]), { name: "흑돼지김치찌개", qty: 2,
    details: ["불고기김치찌개", "참치김치찌개3", "두부추가 ×2"] });
});

test("same-menu pot servings have no empty details line", () => {
  assert.deepEqual(formatKdsTaskDisplay("POT", [
    { name: "흑돼지김치찌개", qty: 2, kind: "POT", options: [] },
  ]), { name: "흑돼지김치찌개", qty: 2, details: [] });
});

test("separate KDS tasks remain separate even when names and table match", () => {
  const one = formatKdsTaskDisplay("POT", [{ name: "흑돼지김치찌개", qty: 1, kind: "POT", options: [] }]);
  const two = formatKdsTaskDisplay("POT", [{ name: "흑돼지김치찌개", qty: 1, kind: "POT", options: [] }]);
  assert.equal(one.qty, 1);
  assert.equal(two.qty, 1);
});

test("menu button allows start and its three-second undo, but not later cooking taps", () => {
  assert.equal(canUseKdsMenuAction("WAITING", null, null, 10000), true);
  assert.equal(canUseKdsMenuAction("COOKING", "WAITING", 10000, 13000, "MENU"), true);
  assert.equal(canUseKdsMenuAction("COOKING", "WAITING", 10000, 13001), false);
  assert.equal(canUseKdsMenuAction("COOKING", "WAITING", 10000, 11000), false);
  assert.equal(canUseKdsMenuAction("COOKING", "DONE", 10000, 11000), false);
  assert.equal(canUseKdsMenuAction("DONE", "COOKING", 10000, 11000), false);
  assert.equal(canUseKdsMenuAction("COOKING", "WAITING", 10000, 11000, "MENU"), true);
  assert.equal(canUseKdsMenuAction("COOKING", "WAITING", 10000, 11000, "STATUS"), false);
  assert.equal(canUseKdsMenuAction("COOKING", "WAITING", 10000, 11000, "TABLE"), false);
  assert.equal(canUndoKdsStatusStart("COOKING", "WAITING", 10000, 11000, "STATUS"), true);
  assert.equal(canUndoKdsStatusStart("COOKING", "WAITING", 10000, 13000, "STATUS"), true);
  assert.equal(canUndoKdsStatusStart("COOKING", "WAITING", 10000, 13001, "STATUS"), false);
  assert.equal(canUndoKdsStatusStart("COOKING", "WAITING", 10000, 11000, "MENU"), false);
  assert.equal(canUndoKdsStatusStart("COOKING", "WAITING", 10000, 11000, "TABLE"), false);
});

test("one batch joins pots and addons but keeps solo and components subordinate", () => {
  const drafts = buildKdsTaskDrafts(10, [
    item(1, "POT", { kdsGroupKey: "STEW", kdsCompletionTimer: true }),
    item(2, "POT", { kdsGroupKey: "STEW" }), item(3, "ADDON"), item(4, "SOLO"),
    item(5, "SOLO", { parentItemId: 1, itemType: "COMPONENT" }),
  ]);
  assert.equal(drafts.length, 2);
  assert.deepEqual(drafts[0].members.map(member => [member.itemId, member.kind]),
    [[1, "POT"], [2, "POT"], [3, "ADDON"], [5, "COMPONENT"]]);
  assert.equal(drafts[0].compatibilityKey, "STEW");
  assert.equal(drafts[0].completionTimer, true);
  assert.deepEqual(drafts[1].members.map(member => member.itemId), [4]);
  assert.deepEqual(buildKdsTaskDrafts(11, [item(6, "ADDON")])[0].members.map(member => member.itemId), [6]);
});

test("completed elapsed display respects each menu's saved setting in a shared pot", () => {
  const drafts = buildKdsTaskDrafts(30, [
    item(1, "POT", { kdsGroupKey: "STEW", kdsCompletionTimer: true }),
    item(2, "POT", { kdsGroupKey: "STEW", kdsCompletionTimer: false }),
    item(3, "ADDON", { kdsCompletionTimer: false }),
    item(4, "SOLO", { kdsCompletionTimer: false }),
  ]);
  assert.equal(drafts.length, 2);
  assert.deepEqual(drafts[0].members.map(member => [member.itemId, member.completionTimer]), [[1, true], [2, false], [3, false]]);
  assert.equal(drafts[1].members[0].completionTimer, false);
  assert.deepEqual(kdsCompletedTimerDisplay([
    { name: "첫째 찌개", kind: "POT", completionTimer: true },
    { name: "둘째 찌개", kind: "POT", completionTimer: false },
    { name: "추가", kind: "ADDON", completionTimer: false },
  ], "POT"), { enabledNames: ["첫째 찌개"], mixed: true });
  assert.deepEqual(kdsCompletedTimerDisplay([{ name: "단품", kind: "SOLO", completionTimer: false }], "SOLO"),
    { enabledNames: [], mixed: false });
  assert.deepEqual(kdsCompletedTimerDisplay([{ name: "단품", kind: "SOLO", completionTimer: true }], "SOLO"),
    { enabledNames: ["단품"], mixed: false });
});

test("different pot cooking groups in one batch remain independent", () => {
  const drafts = buildKdsTaskDrafts(12, [
    item(1, "POT", { kdsGroupKey: "STEW" }),
    item(2, "POT", { kdsGroupKey: "SOUP" }),
    item(3, "ADDON"),
    item(4, "ADDON", { kdsGroupKey: "SOUP" }),
  ]);
  assert.equal(drafts.length, 2);
  assert.deepEqual(drafts.map(draft => draft.members.map(member => member.itemId)), [[1, 3], [2, 4]]);
  assert.deepEqual(drafts.map(draft => draft.compatibilityKey), ["STEW", "SOUP"]);
  const orphan = buildKdsTaskDrafts(13, [item(5, "ADDON", { kdsGroupKey: "SOUP" })]);
  assert.equal(orphan[0].compatibilityKey, "SOLO:SOUP");
});

test("KDS display OFF excludes parent tasks and components without touching the source order", () => {
  const source = [
    item(1, "POT", { kdsGroupKey: "STEW" }),
    item(2, "SOLO", { kdsVisible: false }),
    item(3, "ADDON", { kdsVisible: false }),
    item(4, "NONE", { parentItemId: 1, itemType: "COMPONENT", kdsVisible: false }),
    item(5, "NONE", { parentItemId: 1, itemType: "COMPONENT" }),
    item(6, "SOLO", { parentItemId: 1, itemType: "COMPONENT" }),
  ];
  const drafts = buildKdsTaskDrafts(20, source);
  assert.deepEqual(drafts.map(draft => draft.members.map(member => member.itemId)), [[1, 6]]);
  assert.equal(source.length, 6);
  assert.deepEqual(buildKdsTaskDrafts(21, [item(6, "SOLO", { kdsVisible: false })]), []);
});

test("KDS kind NONE excludes standalone and included component rows regardless of display switch", () => {
  const drafts = buildKdsTaskDrafts(22, [
    item(1, "POT"),
    item(2, "NONE"),
    item(3, "NONE", { parentItemId: 1, itemType: "COMPONENT" }),
    item(4, "SOLO", { parentItemId: 1, itemType: "COMPONENT" }),
  ]);
  assert.deepEqual(drafts.map(draft => draft.members.map(member => [member.itemId, member.kind])), [
    [[1, "POT"], [4, "COMPONENT"]],
  ]);
});

test("start undo resets the original start time and a later start records a fresh group", () => {
  const started = transitionKdsState(waiting, "MENU", 10000, { groupId: 7, startedAtMs: 9900 });
  assert.equal(started.status, "COOKING");
  const undone = transitionKdsState(started, "MENU", 11000);
  assert.equal(undone.status, "WAITING");
  assert.equal(undone.cookingStartedAtMs, null);
  assert.equal(needsNewCookingGroup(undone, 12000), true);
  const restarted = transitionKdsState(undone, "MENU", 12000, { groupId: 9, startedAtMs: 12000 });
  assert.equal(restarted.cookingStartedAtMs, 12000);
  assert.equal(restarted.cookingGroupId, 9);
});

test("a queued second tap can undo after a delayed start response without changing the ordinary three-second rule", () => {
  const started = transitionKdsState(waiting, "MENU", 10000, { groupId: 7, startedAtMs: 10000 });
  assert.equal(transitionKdsState(started, "MENU", 14000), null);
  assert.equal(canAcceptKdsQueuedUndo(1000, 10000, 14000), true);
  assert.equal(canAcceptKdsQueuedUndo(3001, 10000, 14000), false);
  assert.equal(canAcceptKdsQueuedUndo(1000, 10000, 17001), false);
  const undone = transitionKdsState(started, "MENU", 14000, undefined, true);
  assert.equal(undone?.status, "WAITING");
  assert.equal(undone?.cookingStartedAtMs, null);
});

test("completion undo redo preserves original completion and cooking start", () => {
  const started = transitionKdsState(waiting, "MENU", 10000, { groupId: 7, startedAtMs: 10000 });
  const done = transitionKdsState(started, "TIME", 20000);
  assert.equal(done.status, "DONE");
  const restored = transitionKdsState(done, "TIME", 21000);
  assert.equal(restored.status, "COOKING");
  assert.equal(restored.cookingStartedAtMs, 10000);
  const redone = transitionKdsState(restored, "TIME", 22000);
  assert.equal(redone.status, "DONE");
  assert.equal(redone.cookingCompletedAtMs, 20000);
  assert.equal(transitionKdsState(redone, "TIME", 26001), null);
});

test("bulk completion of waiting tasks can be undone inside the quick action window", () => {
  const done = transitionKdsState({ ...waiting, status: "DONE", previousState: waiting, changedAtMs: 10000 }, "TIME", 11000);
  assert.equal(done.status, "WAITING");
});

test("post-cook timer choices accept configured whole minutes in the supported range", () => {
  assert.equal(isKdsPostCookTimerMinutes(3), true);
  assert.equal(isKdsPostCookTimerMinutes(5), true);
  assert.equal(isKdsPostCookTimerMinutes(10), true);
  assert.equal(isKdsPostCookTimerMinutes("3"), false);
  assert.equal(isKdsPostCookTimerMinutes(0), false);
  assert.equal(isKdsPostCookTimerMinutes(15), true);
  assert.equal(isKdsPostCookTimerMinutes(60), true);
  assert.equal(isKdsPostCookTimerMinutes(61), false);
});

test("table completion accepts the optional selected-pot flag as either boolean", () => {
  assert.equal(isKdsSelectedPotTasks(undefined), true);
  assert.equal(isKdsSelectedPotTasks(false), true);
  assert.equal(isKdsSelectedPotTasks(true), true);
  assert.equal(isKdsSelectedPotTasks("false"), false);
  assert.equal(isKdsSelectedPotTasks(0), false);
});

test("external boil-time defaults are valid and selected default must be one of three distinct choices", () => {
  assert.deepEqual(DEFAULT_KDS_COOKING_SETTINGS, { boilTimeOptions: [10, 5, 3], defaultBoilTimeMinutes: 5 });
  assert.equal(isKdsCookingSettings(DEFAULT_KDS_COOKING_SETTINGS), true);
  assert.equal(isKdsCookingSettings({ boilTimeOptions: [10, 5, 5], defaultBoilTimeMinutes: 5 }), false);
  assert.equal(isKdsCookingSettings({ boilTimeOptions: [10, 5, 3], defaultBoilTimeMinutes: 8 }), false);
});

test("rolling three-second group window uses each immediately preceding center start", () => {
  assert.equal(canJoinKdsCookingGroup(0, 2000), true);
  assert.equal(canJoinKdsCookingGroup(2000, 4000), true);
  assert.equal(canJoinKdsCookingGroup(4000, 8001), false);
  assert.equal(canJoinKdsCookingGroup(100, 99), false);
});

test("menu grouping follows the latest active menu start across tables and menu kinds", () => {
  const first = { groupId: 7, startedAtMs: 10000, lastStartAtMs: 10000,
    startSource: "MENU", previousStatus: "WAITING", completionPending: false, compatibilityKey: "STEW" };
  const second = { ...first, lastStartAtMs: 12000, compatibilityKey: "SOLO:FISH" };
  assert.equal(findKdsRecentMenuGroup([first], 12000)?.groupId, 7);
  assert.equal(findKdsRecentMenuGroup([first, second], 14000)?.startedAtMs, 10000);
  assert.equal(findKdsRecentMenuGroup([first, second], 16001), null);
  assert.equal(findKdsRecentMenuGroup([first], 14000), null);
  assert.equal(findKdsRecentMenuGroup([{ ...second, startSource: "TABLE" }], 14000), null);
  assert.equal(findKdsRecentMenuGroup([{ ...second, completionPending: true }], 14000), null);
});

test("grouped menu starts share elapsed time but keep separate undo timestamps", () => {
  const first = transitionKdsState(waiting, "MENU", 10000, { groupId: 7, startedAtMs: 10000 });
  const second = transitionKdsState(waiting, "MENU", 12000, { groupId: 7, startedAtMs: 10000 });
  const third = transitionKdsState(waiting, "MENU", 14000, { groupId: 7, startedAtMs: 10000 });
  assert.deepEqual([first.cookingStartedAtMs, second.cookingStartedAtMs, third.cookingStartedAtMs], [10000, 10000, 10000]);
  assert.deepEqual([first.changedAtMs, second.changedAtMs, third.changedAtMs], [10000, 12000, 14000]);
  assert.equal(transitionKdsState(first, "MENU", 13001), null);
  const undone = transitionKdsState(second, "MENU", 14500);
  assert.equal(undone.status, "WAITING");
  assert.equal(undone.cookingStartedAtMs, null);
  assert.equal(first.status, "COOKING");
  assert.equal(third.status, "COOKING");
});

test("start undo countdown follows the stored start time and each permitted button path", () => {
  for (const source of ["MENU", "STATUS", "TABLE"]) {
    const seconds = [0, 999, 1000, 1999, 2000, 2999, 3000, 3001]
      .map(elapsed => remainingKdsStartUndoSeconds("COOKING", "WAITING", 10000, 10000 + elapsed, source,
        source === "TABLE" ? "batch-1" : null));
    assert.deepEqual(seconds, [3, 3, 2, 2, 1, 1, 1, null]);
  }
  assert.equal(remainingKdsStartUndoSeconds("COOKING", "WAITING", 10000, 9999, "MENU"), null);
  assert.equal(remainingKdsStartUndoSeconds("COOKING", "WAITING", 10000, 11000, "TABLE"), null);
  assert.equal(remainingKdsStartUndoSeconds("COOKING", "DONE", 10000, 11000, "MENU"), null);
});

test("optimistic table starts show the undo countdown before the server returns a batch id", () => {
  assert.equal(remainingKdsStartUndoSeconds("COOKING", "WAITING", 10000, 10000, "TABLE", null, true), 3);
  assert.equal(remainingKdsStartUndoSeconds("COOKING", "WAITING", 10000, 11000, "TABLE", null, true), 2);
  assert.equal(remainingKdsStartUndoSeconds("COOKING", "WAITING", 10000, 10000, "TABLE", null), null);
});

test("start undo countdown follows the initiating device's monotonic click time", () => {
  assert.equal(remainingKdsStartUndoSecondsFromClick(5000, 5000), 3);
  assert.equal(remainingKdsStartUndoSecondsFromClick(5000, 6000), 2);
  assert.equal(remainingKdsStartUndoSecondsFromClick(5000, 7000), 1);
  assert.equal(remainingKdsStartUndoSecondsFromClick(5000, 8000), 1);
  assert.equal(remainingKdsStartUndoSecondsFromClick(5000, 8001), null);
  // Wall-clock/server offset changes do not affect this elapsed click time.
  assert.equal(remainingKdsStartUndoSecondsFromClick(5000, 6500), 2);
});

test("server countdown resumes from stored request time and expires at five seconds", () => {
  assert.equal(remainingKdsCompletionSeconds(10000, 10000), 5);
  assert.equal(remainingKdsCompletionSeconds(10000, 9990), 5);
  assert.equal(remainingKdsCompletionSeconds(10000, 10999), 5);
  assert.equal(remainingKdsCompletionSeconds(10000, 11000), 4);
  assert.equal(remainingKdsCompletionSeconds(10000, 12000), 3);
  assert.equal(remainingKdsCompletionSeconds(10000, 13000), 2);
  assert.equal(remainingKdsCompletionSeconds(10000, 14000), 1);
  assert.equal(remainingKdsCompletionSeconds(10000, 14999), 1);
  assert.equal(remainingKdsCompletionSeconds(10000, 15000), 1);
  assert.equal(remainingKdsCompletionSeconds(10000, 10000, 3), 3);
  assert.equal(remainingKdsCompletionSeconds(10000, 10999, 3), 3);
  assert.equal(remainingKdsCompletionSeconds(10000, 11000, 3), 2);
  assert.equal(remainingKdsCompletionSeconds(10000, 12000, 3), 1);
  assert.equal(remainingKdsCompletionSeconds(10000, 10000, 10), 10);
  for (let second = 0; second < 10; second += 1) {
    assert.equal(remainingKdsCompletionSeconds(10000, 10000 + second * 1000, 10), 10 - second);
  }
  assert.equal(isKdsCompletionCountdownSeconds(1), true);
  assert.equal(isKdsCompletionCountdownSeconds(30), true);
  assert.equal(isKdsCompletionCountdownSeconds(0), false);
  assert.equal(isKdsCompletionCountdownSeconds(31), false);
  assert.equal(isKdsCompletionCountdownSeconds(2.5), false);
  assert.equal(isKdsCompletionCountdownSeconds("5"), false);
  for (let now = 9000; now <= 17000; now += 1) {
    assert.ok(remainingKdsCompletionSeconds(10000, now) >= 1 && remainingKdsCompletionSeconds(10000, now) <= 5);
  }
});

test("table completion remains cancellable through the server finalization grace window", () => {
  const requestedAt = 10000;
  const finalizeAt = kdsTableCompletionFinalizeAtMs(requestedAt, 3);
  assert.equal(finalizeAt, requestedAt + 4000);
  assert.equal(canCancelKdsTableCompletion(requestedAt, requestedAt + 3999, 3), true);
  assert.equal(canFinalizeKdsTableCompletion(requestedAt, requestedAt + 3999, 3), false);
  assert.equal(canCancelKdsTableCompletion(requestedAt, finalizeAt, 3), false);
  assert.equal(canFinalizeKdsTableCompletion(requestedAt, finalizeAt, 3), true);
});

test("table button starts waiting rows and requests completion for cooking rows", () => {
  assert.deepEqual(getKdsTableButtonAction([{ status: "WAITING", changedAtMs: 100 }], 1000), { action: "START" });
  assert.deepEqual(getKdsTableButtonAction([
    { status: "COOKING", changedAtMs: 100 }, { status: "WAITING", changedAtMs: 200 },
  ], 1000), { action: "REQUEST_COMPLETION" });
  assert.deepEqual(getKdsTableButtonAction([
    { status: "COOKING", changedAtMs: 100, completionRequestScope: "TABLE", completionRequestId: "req-1" },
  ], 1000), { action: "CANCEL_TABLE_COMPLETION", requestId: "req-1" });
  assert.deepEqual(getKdsTableButtonAction([
    { taskId: 42, status: "COOKING", changedAtMs: 100, completionRequestScope: "TASK", completionRequestedAtMs: 900 },
  ], 1000), { action: "CANCEL_TASK_COMPLETIONS", taskIds: [42] });
  assert.deepEqual(getKdsTableButtonAction([
    { taskId: 42, status: "COOKING", changedAtMs: 100, completionRequestScope: "TASK", completionRequestedAtMs: 900 },
    { taskId: 43, status: "WAITING", changedAtMs: 200 },
  ], 1000), { action: "CANCEL_TASK_COMPLETIONS", taskIds: [42] });
});

test("table completion countdown cancellation takes priority over the start undo window", () => {
  assert.deepEqual(getKdsTableButtonAction([
    { status: "COOKING", changedAtMs: 8000, bulkStartId: "batch-1", completionRequestScope: "TABLE", completionRequestId: "req-1",
      taskId: 42, completionRequestedAtMs: 9000 },
    { status: "COOKING", changedAtMs: 8000, bulkStartId: "batch-1", taskId: 43 },
    { status: "COOKING", changedAtMs: 8000, bulkStartId: "batch-1", taskId: 44 },
  ], 10000), { action: "CANCEL_TABLE_COMPLETION", requestId: "req-1" });
  assert.deepEqual(getKdsTableButtonAction([
    { status: "WAITING", changedAtMs: null, taskId: 43 },
    { status: "COOKING", changedAtMs: 8000, taskId: 44, completionRequestScope: "TASK", completionRequestedAtMs: 9000 },
  ], 10000, "batch-local"), { action: "CANCEL_TASK_COMPLETIONS", taskIds: [44] });
  assert.deepEqual(getKdsTableButtonAction([{ status: "DONE", changedAtMs: 5000 }], 10000), { action: "NOOP" });
});

test("a successful table cancellation suppresses stale refresh data and restores the cooking action", () => {
  const pending = { sessionId: 42, taskId: 10, status: "COOKING", changedAtMs: 1000,
    startedAtMs: 500, completionRequestId: "request-1", completionRequestScope: "TABLE",
    completionRequestedAtMs: 2000, completionCountdownSeconds: 3, pendingPostCookTimerMinutes: 5 };
  const refreshed = clearCancelledKdsTableCompletionRequests([pending], new Set(["42:request-1"]));
  assert.equal(refreshed[0].status, "COOKING");
  assert.equal(refreshed[0].startedAtMs, 500);
  assert.equal(refreshed[0].completionRequestedAtMs, null);
  assert.equal(refreshed[0].completionRequestId, null);
  assert.equal(refreshed[0].completionRequestScope, null);
  assert.equal(refreshed[0].completionCountdownSeconds, null);
  assert.equal(refreshed[0].pendingPostCookTimerMinutes, null);
  assert.deepEqual(getKdsTableButtonAction(refreshed, 2500), { action: "REQUEST_COMPLETION" });
});

test("a table countdown cancel can recover only its own completion during the short commit race window", () => {
  assert.equal(canRecoverKdsTableCompletionCancellation(5000, 5000), true);
  assert.equal(canRecoverKdsTableCompletionCancellation(5000, 9999), true);
  assert.equal(canRecoverKdsTableCompletionCancellation(5000, 10001), false);
  assert.equal(canRecoverKdsTableCompletionCancellation(5000, 4999), false);
});

test("a table cancel tapped while the request is in flight is sent once the server returns its request id", async () => {
  let resolveRequest;
  const request = new Promise(resolve => { resolveRequest = resolve; });
  const operation = { cancelRequested: false };
  const cancelledIds = [];
  const flow = honorQueuedKdsTableCompletionCancel(request, () => operation.cancelRequested, async result => {
    cancelledIds.push(result.requestId);
  });

  operation.cancelRequested = true;
  resolveRequest({ requestId: "table-request-1" });
  const result = await flow;

  assert.equal(result.cancelled, true);
  assert.deepEqual(cancelledIds, ["table-request-1"]);
});

test("a table request without a queued cancel proceeds without a cancel API call", async () => {
  let cancelCalls = 0;
  const result = await honorQueuedKdsTableCompletionCancel(Promise.resolve({ requestId: "table-request-2" }),
    () => false, async () => { cancelCalls += 1; });
  assert.equal(result.cancelled, false);
  assert.equal(cancelCalls, 0);
});

test("table-start undo requires the complete unique task group", () => {
  assert.equal(matchesKdsTableStartBatch([11, 12, 13], [13, 11, 12]), true);
  assert.equal(matchesKdsTableStartBatch([11, 12, 13], [11, 12]), false);
  assert.equal(matchesKdsTableStartBatch([11, 12], [11, 12, 13]), false);
  assert.equal(matchesKdsTableStartBatch([11, 11], [11, 12]), false);
});

test("table button cancels its table-wide completion countdown at every visible value", () => {
  const taskRequest = { taskId: 42, status: "COOKING", changedAtMs: 100, completionRequestScope: "TASK", completionRequestedAtMs: 1000 };
  const tableRequest = { status: "COOKING", changedAtMs: 100, completionRequestScope: "TABLE", completionRequestId: "req-1" };
  for (const elapsed of [0, 1000, 2000, 3000, 4000]) {
    assert.equal(getKdsTableButtonAction([taskRequest], 1000 + elapsed).action, "CANCEL_TASK_COMPLETIONS");
    assert.equal(getKdsTableButtonAction([tableRequest], 1000 + elapsed).action, "CANCEL_TABLE_COMPLETION");
  }
});

test("a task completion cancel takes priority over the 3-second start undo path", () => {
  const taskRequest = { taskId: 42, status: "COOKING", changedAtMs: 8000, bulkStartId: "batch-1",
    completionRequestScope: "TASK", completionRequestedAtMs: 9000 };
  assert.deepEqual(getKdsTableButtonAction([taskRequest], 9500, "batch-1"), {
    action: "CANCEL_TASK_COMPLETIONS", taskIds: [42],
  });
});

test("table-click task cancel clears its scheduled finalizer and calls only the cancel API", async () => {
  let finalizeCalls = 0;
  let cancelCalls = 0;
  const task = { taskId: 42, status: "COOKING", changedAtMs: 8000, completionRequestScope: "TASK", completionRequestedAtMs: 9000 };
  const fakeTimers = new Map([[task.taskId, () => { finalizeCalls += 1; }]]);
  await cancelKdsTaskCompletionRequests([task], async () => { cancelCalls += 1; }, taskId => fakeTimers.delete(taskId));
  for (const timer of fakeTimers.values()) timer();
  assert.equal(cancelCalls, 1);
  assert.equal(finalizeCalls, 0);
  assert.equal(fakeTimers.size, 0);
});

test("partial cancellation leaves only the remaining quantity", () => {
  assert.equal(remainingKdsQuantity(3, 1, false), 2);
  assert.equal(remainingKdsQuantity(3, 3, false), 0);
  assert.equal(remainingKdsQuantity(3, 1, true), 0);
});

test("completed time text shrinks once per minute over five minutes after the configured start", () => {
  const completedAt = 1_000_000;
  for (const [minutes, expected] of [[9, 0], [10, 0], [11, 1], [12, 2], [13, 3], [14, 4], [15, 5], [16, 5]]) {
    assert.equal(kdsCompletedTimeShrinkStage(completedAt, completedAt + minutes * 60_000, 10), expected);
  }
  assert.equal(kdsCompletedTimeShrinkStage(completedAt, completedAt + 11 * 60_000 - 1, 10), 0);
  assert.equal(kdsCompletedTimeShrinkStage(completedAt, completedAt + 15 * 60_000, 10), 5);
  assert.equal(kdsCompletedTimeShrinkStage(null, completedAt + 20 * 60_000, 10), 0);
  assert.equal(kdsCompletedTimeShrinkStage(completedAt, completedAt + 60_000, 0), 1);
  for (const value of [0, 10, 120]) assert.equal(isKdsCompletedTimeShrinkStartMinutes(value), true);
  for (const value of [-1, 121, 1.5, "10", null]) assert.equal(isKdsCompletedTimeShrinkStartMinutes(value), false);
});

test("completed tab elapsed minutes start at confirmation and continue after the font reaches its minimum", () => {
  const completedAt = 1_000_000;
  for (const [minutes, expected] of [[0, 0], [1, 1], [2, 2], [15, 15], [16, 16], [60, 60], [100, 100], [125, 125]]) {
    const now = completedAt + minutes * 60_000;
    assert.equal(kdsCompletedElapsedMinutes(completedAt, now), expected);
    if (minutes >= 15) assert.equal(kdsCompletedTimeShrinkStage(completedAt, now, 10), 5);
  }
  assert.equal(kdsCompletedElapsedMinutes(completedAt, completedAt + 59_999), 0);
  assert.equal(kdsCompletedElapsedMinutes(completedAt, completedAt - 1_000), 0);
  assert.equal(kdsCompletedElapsedMinutes(null, completedAt), null);
  assert.equal(kdsCompletedElapsedMinutes(0, completedAt), null);
  assert.equal(kdsCompletedElapsedMinutes(completedAt + 4 * 60_000, completedAt + 10 * 60_000), 6);
});

test("each completed task uses its own confirmed timestamp", () => {
  const now = 10_000_000;
  assert.deepEqual([10, 4, 0].map(minutes => kdsCompletedElapsedMinutes(now - minutes * 60_000, now)), [10, 4, 0]);
});
