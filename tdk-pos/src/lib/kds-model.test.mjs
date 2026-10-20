import assert from "node:assert/strict";
import test from "node:test";
import { buildKdsTaskDrafts, needsNewCookingGroup, remainingKdsQuantity, transitionKdsState } from "./kds-model.ts";

const item = (itemId, kdsKind, overrides = {}) => ({
  itemId, parentItemId: null, menuId: itemId, itemType: "NORMAL",
  kdsKind, kdsGroupKey: null, kdsCompletionTimer: false, printOnKitchen: true, kdsVisible: true,
  ...overrides,
});
const waiting = { status: "WAITING", cookingGroupId: null, cookingStartedAtMs: null,
  cookingCompletedAtMs: null, previousState: null, changedAtMs: null };

test("one batch joins pots and addons but keeps solo and components subordinate", () => {
  const drafts = buildKdsTaskDrafts(10, [
    item(1, "POT", { kdsGroupKey: "STEW", kdsCompletionTimer: true }),
    item(2, "POT", { kdsGroupKey: "STEW" }), item(3, "ADDON"), item(4, "SOLO"),
    item(5, "NONE", { parentItemId: 1, itemType: "COMPONENT" }),
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
  ];
  const drafts = buildKdsTaskDrafts(20, source);
  assert.deepEqual(drafts.map(draft => draft.members.map(member => member.itemId)), [[1, 5]]);
  assert.equal(source.length, 5);
  assert.deepEqual(buildKdsTaskDrafts(21, [item(6, "SOLO", { kdsVisible: false })]), []);
});

test("start undo redo restores original group and time; later restart is new", () => {
  const started = transitionKdsState(waiting, "MENU", 10000, { groupId: 7, startedAtMs: 9900 });
  assert.equal(started.status, "COOKING");
  const undone = transitionKdsState(started, "MENU", 11000);
  assert.equal(undone.status, "WAITING");
  assert.equal(needsNewCookingGroup(undone, 12000), false);
  const redone = transitionKdsState(undone, "MENU", 12000);
  assert.equal(redone.cookingGroupId, 7);
  assert.equal(redone.cookingStartedAtMs, 9900);
  const undoneAgain = transitionKdsState(redone, "MENU", 12500);
  assert.equal(needsNewCookingGroup(undoneAgain, 16001), true);
  const restarted = transitionKdsState(undoneAgain, "MENU", 16001, { groupId: 9, startedAtMs: 16001 });
  assert.equal(restarted.cookingStartedAtMs, 16001);
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

test("partial cancellation leaves only the remaining quantity", () => {
  assert.equal(remainingKdsQuantity(3, 1, false), 2);
  assert.equal(remainingKdsQuantity(3, 3, false), 0);
  assert.equal(remainingKdsQuantity(3, 1, true), 0);
});
