import assert from "node:assert/strict";
import test from "node:test";
import { buildKdsTaskDrafts, canJoinKdsCookingGroup, canUndoKdsStatusStart, canUseKdsMenuAction, DEFAULT_KDS_COOKING_SETTINGS, getKdsTableButtonAction, isKdsCookingSettings, isKdsPostCookTimerMinutes, needsNewCookingGroup, remainingKdsCompletionSeconds, remainingKdsQuantity, transitionKdsState } from "./kds-model.ts";

const item = (itemId, kdsKind, overrides = {}) => ({
  itemId, parentItemId: null, menuId: itemId, itemType: "NORMAL",
  kdsKind, kdsGroupKey: null, kdsCompletionTimer: false, printOnKitchen: true, kdsVisible: true,
  ...overrides,
});
const waiting = { status: "WAITING", cookingGroupId: null, cookingStartedAtMs: null,
  cookingCompletedAtMs: null, previousState: null, changedAtMs: null };

test("menu button allows start and its three-second undo, but not later cooking taps", () => {
  assert.equal(canUseKdsMenuAction("WAITING", null, null, 10000), true);
  assert.equal(canUseKdsMenuAction("COOKING", "WAITING", 10000, 13000), true);
  assert.equal(canUseKdsMenuAction("COOKING", "WAITING", 10000, 13001), false);
  assert.equal(canUseKdsMenuAction("COOKING", "DONE", 10000, 11000), false);
  assert.equal(canUseKdsMenuAction("DONE", "COOKING", 10000, 11000), false);
  assert.equal(canUseKdsMenuAction("COOKING", "WAITING", 10000, 11000, "MENU"), true);
  assert.equal(canUseKdsMenuAction("COOKING", "WAITING", 10000, 11000, "STATUS"), false);
  assert.equal(canUseKdsMenuAction("COOKING", "WAITING", 10000, 11000, "TABLE"), false);
  assert.equal(canUndoKdsStatusStart("COOKING", "WAITING", 10000, 11000, "STATUS"), true);
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
  for (let now = 9000; now <= 17000; now += 1) {
    assert.ok(remainingKdsCompletionSeconds(10000, now) >= 1 && remainingKdsCompletionSeconds(10000, now) <= 5);
  }
});

test("table button starts waiting rows, requests table completion for cooking rows, and cancels a pending table countdown", () => {
  assert.deepEqual(getKdsTableButtonAction([{ status: "WAITING", changedAtMs: 100 }], 1000), { action: "START" });
  assert.deepEqual(getKdsTableButtonAction([
    { status: "COOKING", changedAtMs: 100 }, { status: "WAITING", changedAtMs: 200 },
  ], 1000), { action: "REQUEST_COMPLETION" });
  assert.deepEqual(getKdsTableButtonAction([
    { status: "COOKING", changedAtMs: 100, completionRequestScope: "TABLE", completionRequestId: "req-1" },
  ], 1000), { action: "CANCEL_COMPLETION", requestId: "req-1" });
});

test("recent table-start undo takes priority over a table completion countdown", () => {
  assert.deepEqual(getKdsTableButtonAction([
    { status: "COOKING", changedAtMs: 8000, bulkStartId: "batch-1", completionRequestScope: "TABLE", completionRequestId: "req-1" },
  ], 10000), { action: "UNDO_START", batchStartId: "batch-1" });
  assert.deepEqual(getKdsTableButtonAction([{ status: "DONE", changedAtMs: 5000 }], 10000), { action: "NOOP" });
});



test("partial cancellation leaves only the remaining quantity", () => {
  assert.equal(remainingKdsQuantity(3, 1, false), 2);
  assert.equal(remainingKdsQuantity(3, 3, false), 0);
  assert.equal(remainingKdsQuantity(3, 1, true), 0);
});
