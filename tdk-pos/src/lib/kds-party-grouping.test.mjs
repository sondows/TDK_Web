import assert from "node:assert/strict";
import { test } from "node:test";
import { activeKdsTableTasks, completeKdsTableOrder, countKdsTablesByStatus, groupKdsPotDisplayRows, groupKdsTasksByParty, moveKdsPartyTable, moveKdsTableGroup, moveKdsTableToBoundary, oldestKdsTableOrderedAtMs, partyHasActiveTask, preparingKdsPartyCards, reorderKdsPartyTableToTarget, reorderKdsTableGroupToTarget, reorderKdsTableIds, sortKdsPartyCardsByLatestOrder, sortKdsPartyMembers, sortKdsTableGroups, sortKdsTableIdsByReceivedOrder } from "./kds-party-grouping.ts";
import { formatKdsTaskDisplay } from "./kds-model.ts";

const task = (taskId, sessionId, groupId, status = "WAITING", sessionKind = "DINE_IN") =>
  ({ taskId, orderId: sessionId, orderedAtMs: 1_000, completedAtMs: status === "DONE" ? 2_000 : null,
    sessionId, groupId, sessionKind, status, cancelled: false });

test("same-session compatible stews from separate orders share one row without changing task IDs", () => {
  const pot = (taskId, name, status = "WAITING", sessionKind = "DINE_IN") => ({
    ...task(taskId, 11, null, status, sessionKind), kind: "POT", compatibilityKey: "STEW",
    startedAtMs: null, completionRequestScope: null, completionRequestId: null, completionRequestedAtMs: null,
    items: [{ name, kind: "POT", qty: 1, options: [] }],
  });
  const rows = groupKdsPotDisplayRows([
    pot(188, "불고기김치찌개"), pot(186, "흑돼지김치찌개"),
    { ...pot(189, "참치김치찌개"), compatibilityKey: "OTHER" },
  ]);
  assert.deepEqual(rows.map(row => row.map(item => item.taskId)), [[186, 188], [189]]);
  assert.deepEqual(formatKdsTaskDisplay("POT", rows[0].flatMap(member => member.items)), {
    name: "흑돼지김치찌개", qty: 1, details: ["불고기김치찌개"],
  });
  assert.equal(groupKdsPotDisplayRows([pot(1, "흑돼지김치찌개"), pot(2, "불고기김치찌개", "COOKING")]).length, 2);
  assert.equal(groupKdsPotDisplayRows([
    { ...pot(1, "흑돼지김치찌개", "COOKING"), startedAtMs: 1000 },
    { ...pot(2, "불고기김치찌개", "COOKING"), startedAtMs: 2000 },
  ]).length, 2);
  assert.equal(groupKdsPotDisplayRows([pot(1, "흑돼지김치찌개"), { ...pot(2, "불고기김치찌개"), sessionId: 12 }]).length, 2);
  assert.equal(groupKdsPotDisplayRows([pot(1, "흑돼지김치찌개", "WAITING", "TAKEOUT_PHONE"), pot(2, "불고기김치찌개", "WAITING", "TAKEOUT_PHONE")]).length, 2);
});

test("KDS table order is independent of party grouping and keeps unranked new sessions at the end", () => {
  const tables = [{ sessionId: 8, groupId: 1 }, { sessionId: 3, groupId: 1 }, { sessionId: 6, groupId: 2 }];
  assert.deepEqual(sortKdsTableGroups(tables, { 6: 0, 8: 1 }), [tables[2], tables[0], tables[1]]);
});

test("drag and top/bottom moves address one session only", () => {
  assert.deepEqual(reorderKdsTableIds([8, 3, 6, 1], 1, 0), [1, 8, 3, 6]);
  assert.deepEqual(moveKdsTableToBoundary([8, 3, 6, 1], 6, "top"), [6, 8, 3, 1]);
  assert.deepEqual(moveKdsTableToBoundary([8, 3, 6, 1], 3, "bottom"), [8, 6, 1, 3]);
});

test("manual buttons move a whole party group and swap it with adjacent groups", () => {
  const tables = [
    { sessionId: 8, groupKey: "party:a" },
    { sessionId: 6, groupKey: "session:6" },
    { sessionId: 3, groupKey: "party:a" },
    { sessionId: 1, groupKey: "session:1" },
  ];
  assert.deepEqual(moveKdsTableGroup(tables, 6, "up"), [6, 8, 3, 1]);
  assert.deepEqual(moveKdsTableGroup(tables, 6, "down"), [8, 3, 1, 6]);
  assert.deepEqual(moveKdsTableGroup(tables, 6, "top"), [6, 8, 3, 1]);
  assert.deepEqual(moveKdsTableGroup(tables, 8, "bottom"), [6, 1, 8, 3]);
  assert.deepEqual(moveKdsTableGroup(tables, 8, "up"), [8, 3, 6, 1]);
});

test("party internal ranks reorder only members within their existing global slots", () => {
  const tables = [
    { sessionId: 8, groupKey: "party:4" },
    { sessionId: 3, groupKey: "party:4" },
    { sessionId: 6, groupKey: "session:6" },
    { sessionId: 1, groupKey: "party:4" },
    { sessionId: 7, groupKey: "party:9" },
  ];
  assert.deepEqual(sortKdsPartyMembers(tables, { 1: 0, 3: 1, 8: 2 }), [
    tables[3], tables[1], tables[2], tables[0], tables[4],
  ]);
  assert.deepEqual(sortKdsPartyMembers(tables, {}), tables);
});

test("party internal manual and drag moves cannot reorder outside tables", () => {
  const members = [{ sessionId: 8 }, { sessionId: 3 }, { sessionId: 1 }];
  assert.deepEqual(moveKdsPartyTable(members, 3, "top"), [3, 8, 1]);
  assert.deepEqual(moveKdsPartyTable(members, 8, "down"), [3, 8, 1]);
  assert.deepEqual(moveKdsPartyTable(members, 1, "bottom"), [8, 3, 1]);
  assert.deepEqual(reorderKdsPartyTableToTarget(members, 1, 8), [1, 8, 3]);
  assert.deepEqual(reorderKdsPartyTableToTarget(members, 8, 1), [3, 1, 8]);
  assert.deepEqual(reorderKdsTableGroupToTarget([
    { sessionId: 8, groupKey: "party:4" },
    { sessionId: 3, groupKey: "party:4" },
    { sessionId: 6, groupKey: "session:6" },
  ], 3, 8), [8, 3, 6]);
});

test("dragging a table moves its whole party group next to the drop target group", () => {
  const tables = [
    { sessionId: 8, groupKey: "party:a" },
    { sessionId: 6, groupKey: "session:6" },
    { sessionId: 3, groupKey: "party:a" },
    { sessionId: 1, groupKey: "session:1" },
  ];
  assert.deepEqual(reorderKdsTableGroupToTarget(tables, 8, 1), [6, 1, 8, 3]);
  assert.deepEqual(reorderKdsTableGroupToTarget(tables, 6, 8), [6, 8, 3, 1]);
  assert.deepEqual(reorderKdsTableGroupToTarget(tables, 8, 3), [8, 3, 6, 1]);
});

test("received-order restoration keeps existing party tables contiguous and uses each table's first order", () => {
  const groups = [
    { key: "party:7", tables: [
      { sessionId: 30, tasks: [{ orderedAtMs: 400 }, { orderedAtMs: 700 }] },
      { sessionId: 50, tasks: [{ orderedAtMs: 100 }, { orderedAtMs: 900 }] },
    ] },
    { key: "session:60", tables: [{ sessionId: 60, tasks: [{ orderedAtMs: 200 }] }] },
  ];
  assert.deepEqual(sortKdsTableIdsByReceivedOrder(groups), [50, 30, 60]);
});

test("received-order restoration keeps input order when receipt times are unavailable", () => {
  const groups = [
    { key: "session:2", tables: [{ sessionId: 2, tasks: [{ orderedAtMs: Number.NaN }] }] },
    { key: "session:1", tables: [{ sessionId: 1, tasks: [{ orderedAtMs: Number.NaN }] }] },
  ];
  assert.deepEqual(sortKdsTableIdsByReceivedOrder(groups), [2, 1]);
});

test("order saves preserve a newly arrived table after the user ordered visible tables", () => {
  assert.deepEqual(completeKdsTableOrder([8, 3, 6], [8, 3, 6, 9], { 9: 4 }, { 9: 20 }), [8, 3, 6, 9]);
  assert.deepEqual(completeKdsTableOrder([8, 3], [8, 3, 6, 9], { 6: 3, 9: 5 }, {}), [8, 3, 6, 9]);
  assert.equal(completeKdsTableOrder([8, 8], [8], {}, {}), null);
  assert.equal(completeKdsTableOrder([99], [8], {}, {}), null);
});

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

test("bulk table completion targets only active non-cancelled tasks", () => {
  const tasks = [
    { taskId: 1, status: "COOKING", cancelled: false },
    { taskId: 2, status: "WAITING", cancelled: true },
    { taskId: 3, status: "DONE", cancelled: false },
  ];
  assert.deepEqual(activeKdsTableTasks(tasks).map(task => task.taskId), [1]);
});

test("preparing table age follows the oldest unfinished order after additional orders", () => {
  const oldOrder = { ...task(1, 30, null), orderedAtMs: 1_000 };
  const newerOrder = { ...task(2, 30, null), orderedAtMs: 1_201_000 };
  const tasks = [oldOrder, newerOrder];
  assert.equal(oldestKdsTableOrderedAtMs(tasks, true), 1_000);
  oldOrder.status = "DONE";
  assert.equal(oldestKdsTableOrderedAtMs(tasks, true), 1_201_000);
  assert.equal(oldestKdsTableOrderedAtMs(groupKdsTasksByParty(tasks)[0].tables[0].tasks, true), 1_201_000);
  newerOrder.status = "DONE";
  assert.equal(oldestKdsTableOrderedAtMs(tasks, false), 1_000);
});

test("both tabs share tables while counts reflect distinct unfinished and finished tables", () => {
  const pending = task(1, 30, 7);
  const finished = task(2, 30, 7, "DONE");
  const otherTable = task(3, 50, 7, "DONE");
  const cards = groupKdsTasksByParty([pending, finished, otherTable]);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].tables.map(table => table.tasks.map(item => item.taskId)), [[1, 2], [3]]);
  assert.equal(countKdsTablesByStatus(cards, "preparing"), 1);
  assert.equal(countKdsTablesByStatus(cards, "completed"), 2);
  pending.status = "DONE";
  assert.equal(countKdsTablesByStatus(cards, "preparing"), 0);
  assert.equal(countKdsTablesByStatus(cards, "completed"), 2);
  const additionalOrder = task(4, 30, 7);
  cards[0].tables[0].tasks.push(additionalOrder);
  assert.equal(countKdsTablesByStatus(cards, "preparing"), 1);
  assert.equal(countKdsTablesByStatus(cards, "completed"), 2);
});

test("a cooking completion request counts as unfinished until server confirmation", () => {
  const current = task(5, 90, null, "WAITING");
  const cards = groupKdsTasksByParty([current]);
  assert.equal(countKdsTablesByStatus(cards, "preparing"), 1);
  assert.equal(countKdsTablesByStatus(cards, "completed"), 0);
  current.status = "COOKING";
  current.completionRequestedAtMs = 123_000;
  assert.equal(countKdsTablesByStatus(cards, "preparing"), 1);
  assert.equal(countKdsTablesByStatus(cards, "completed"), 0);
  current.status = "DONE";
  assert.equal(countKdsTablesByStatus(cards, "preparing"), 0);
  assert.equal(countKdsTablesByStatus(cards, "completed"), 1);
});

test("preparing keeps completed context while current-session work remains", () => {
  const finished = task(1, 11, 7, "DONE");
  const waiting = task(2, 11, 7);
  const counting = { ...task(3, 11, 7, "COOKING"), completionRequestedAtMs: 123_000 };
  const otherFinished = task(4, 12, 7, "DONE");
  const cards = groupKdsTasksByParty([finished, waiting, counting, otherFinished]);
  assert.deepEqual(preparingKdsPartyCards(cards)[0].tables.map(table => table.tasks.map(item => item.taskId)), [[1, 2, 3]]);
  assert.deepEqual(cards[0].tables.map(table => table.tasks.map(item => item.taskId)), [[1, 2, 3], [4]]);
  waiting.status = "DONE";
  waiting.completedAtMs = 2_100;
  assert.deepEqual(preparingKdsPartyCards(cards)[0].tables[0].tasks.map(item => item.taskId), [1, 2, 3]);
  counting.status = "DONE";
  counting.completedAtMs = 2_200;
  assert.deepEqual(preparingKdsPartyCards(cards), []);
  const additional = { ...task(5, 11, 7), orderId: 13, orderedAtMs: 3_000 };
  cards[0].tables[0].tasks.push(additional);
  assert.deepEqual(preparingKdsPartyCards(cards)[0].tables[0].tasks.map(item => item.taskId), [1, 2, 3, 5]);
  assert.deepEqual(activeKdsTableTasks(preparingKdsPartyCards(cards)[0].tables[0].tasks)
    .map(item => item.taskId), [5]);
  waiting.status = "COOKING";
  waiting.completedAtMs = null;
  assert.deepEqual(preparingKdsPartyCards(cards)[0].tables[0].tasks.map(item => item.taskId), [1, 2, 3, 5]);
  waiting.status = "DONE";
  waiting.completedAtMs = 3_100;
  additional.status = "DONE";
  additional.completedAtMs = 3_200;
  assert.deepEqual(preparingKdsPartyCards(cards), []);
  const nextAdditional = { ...task(6, 11, 7), orderId: 14, orderedAtMs: 4_000 };
  cards[0].tables[0].tasks.push(nextAdditional);
  assert.deepEqual(preparingKdsPartyCards(cards)[0].tables[0].tasks.map(item => item.taskId), [1, 2, 3, 5, 6]);
});

test("preparing keeps reopened work isolated by table session", () => {
  const previousSessionDone = { ...task(1, 11, 7, "DONE"), orderId: 101 };
  const currentSessionWaiting = { ...task(2, 12, 7), orderId: 102 };
  const cards = groupKdsTasksByParty([previousSessionDone, currentSessionWaiting]);
  const visible = preparingKdsPartyCards(cards);
  assert.deepEqual(visible.map(card => card.tables.map(table => table.sessionId)), [[12]]);
  assert.deepEqual(visible[0].tables[0].tasks.map(item => item.taskId), [2]);
});

test("additional orders show earlier completed items as context in preparing", () => {
  const finished = { ...task(1, 11, null, "DONE"), completedAtMs: 2_000 };
  const cooking = { ...task(2, 11, null, "COOKING"), completedAtMs: null };
  const additional = { ...task(3, 11, null), orderId: 12, orderedAtMs: 3_000 };
  const cards = groupKdsTasksByParty([finished, cooking, additional]);
  assert.deepEqual(preparingKdsPartyCards(cards)[0].tables[0].tasks.map(item => item.taskId), [1, 2, 3]);
  cooking.status = "DONE";
  cooking.completedAtMs = 4_000;
  assert.deepEqual(preparingKdsPartyCards(cards)[0].tables[0].tasks.map(item => item.taskId), [1, 2, 3]);
  assert.deepEqual(cards[0].tables[0].tasks.map(item => item.taskId), [1, 2, 3]);
});

test("an unacknowledged cancelled task remains visible for existing cancellation handling", () => {
  const cancelled = { ...task(1, 11, null, "DONE"), cancelled: true };
  const cards = groupKdsTasksByParty([cancelled]);
  assert.equal(preparingKdsPartyCards(cards)[0].tables[0].tasks[0], cancelled);
});

test("completed tab orders tables by latest real order time without changing preparing order", () => {
  const old = { ...task(1, 6, null, "DONE"), orderedAtMs: 1_000 };
  const middle = { ...task(2, 11, null), orderedAtMs: 12_101_000 };
  const recent = { ...task(3, 10, null), orderedAtMs: 14_501_000 };
  const cards = groupKdsTasksByParty([old, middle, recent]);
  const sessionOrder = source => source.map(card => card.tables[0].sessionId);
  assert.deepEqual(sessionOrder(sortKdsPartyCardsByLatestOrder(cards)), [10, 11, 6]);
  assert.deepEqual(sessionOrder(cards), [6, 11, 10]);
  middle.status = "DONE";
  assert.deepEqual(sessionOrder(sortKdsPartyCardsByLatestOrder(cards)), [10, 11, 6]);
  cards[1].tables[0].tasks.push({ ...task(4, 11, null), orderedAtMs: 15_000_000 });
  assert.deepEqual(sessionOrder(sortKdsPartyCardsByLatestOrder(cards)), [11, 10, 6]);
  assert.deepEqual(sessionOrder(sortKdsPartyCardsByLatestOrder(cards)), [11, 10, 6]);
  assert.deepEqual(sessionOrder(cards), [6, 11, 10]);
});

test("party cards keep tables together and equal timestamps have stable ID order", () => {
  const cards = groupKdsTasksByParty([
    { ...task(1, 20, 7), orderedAtMs: 5_000 },
    { ...task(2, 10, 7), orderedAtMs: 9_000 },
    { ...task(3, 30, null), orderedAtMs: 9_000 },
  ]);
  const sorted = sortKdsPartyCardsByLatestOrder(cards);
  assert.deepEqual(sorted.map(card => card.key), ["party:7", "session:30"]);
  assert.deepEqual(sorted[0].tables.map(table => table.sessionId), [10, 20]);
  assert.deepEqual(cards[0].tables.map(table => table.sessionId), [20, 10]);
});
