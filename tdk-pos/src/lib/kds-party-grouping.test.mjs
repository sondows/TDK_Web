import assert from "node:assert/strict";
import { test } from "node:test";
import { groupKdsTasksByParty, partyHasActiveTask } from "./kds-party-grouping.ts";

const task = (taskId, sessionId, groupId, status = "WAITING", sessionKind = "DINE_IN") =>
  ({ taskId, sessionId, groupId, sessionKind, status, cancelled: false });

test("standalone tables stay in separate cards and party tables share one card", () => {
  const cards = groupKdsTasksByParty([
    task(1, 30, 7), task(2, 60, null), task(3, 50, 7), task(4, 80, 7),
  ]);
  assert.deepEqual(cards.map(card => card.key), ["party:7", "session:60"]);
  assert.deepEqual(cards[0].tables.map(table => table.sessionId), [30, 50, 80]);
  assert.deepEqual(cards[1].tables.map(table => table.sessionId), [60]);
});

test("each table retains its own task order after interleaved new orders and polling", () => {
  const source = [task(1, 30, 7), task(2, 50, 7), task(3, 30, 7), task(4, 50, 7)];
  for (let poll = 0; poll < 2; poll++) {
    const [card] = groupKdsTasksByParty(source);
    assert.deepEqual(card.tables.map(table => table.tasks.map(item => item.taskId)), [[1, 3], [2, 4]]);
  }
});

test("a party remains in preparing when another table is done", () => {
  const [card] = groupKdsTasksByParty([task(1, 30, 7, "DONE"), task(2, 50, 7)]);
  assert.equal(partyHasActiveTask(card), true);
  assert.equal(partyHasActiveTask(groupKdsTasksByParty([task(1, 30, 7, "DONE")])[0]), false);
});

test("takeout is isolated even if a group id or session id resembles a party key", () => {
  const cards = groupKdsTasksByParty([
    task(1, 30, 7), task(2, 50, 7, "WAITING", "TAKEOUT_PHONE"), task(3, 7, null),
  ]);
  assert.deepEqual(cards.map(card => card.key), ["party:7", "session:50", "session:7"]);
});
