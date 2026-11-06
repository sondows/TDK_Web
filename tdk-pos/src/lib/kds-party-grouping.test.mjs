import assert from "node:assert/strict";
import { test } from "node:test";
import { activeKdsTableTasks, attachKdsOrderBundleAddons, buildKdsOrderBundleKeys, buildKdsTableOrderBundleKeys, completeKdsTableOrder, countKdsTablesByStatus, groupKdsPotDisplayRows, groupKdsTasksByParty, moveKdsPartyTable, moveKdsTableGroup, moveKdsTableToBoundary, oldestKdsTableOrderedAtMs, partyHasActiveTask, preparingKdsPartyCards, reorderKdsPartyTableToTarget, reorderKdsTableGroupToTarget, reorderKdsTableIds, sortKdsPartyCardsByLatestOrder, sortKdsPartyMembers, sortKdsTableGroups, sortKdsTableIdsByReceivedOrder } from "./kds-party-grouping.ts";
import { DEFAULT_KDS_ORDER_BUNDLE_SETTINGS, formatKdsTaskDisplay, isKdsOrderBundleSettings, transitionKdsLinkedAddonState } from "./kds-model.ts";

const task = (taskId, sessionId, groupId, status = "WAITING", sessionKind = "DINE_IN") =>
  ({ taskId, orderId: sessionId, orderedAtMs: 1_000, completedAtMs: status === "DONE" ? 2_000 : null,
    sessionId, groupId, sessionKind, status, cancelled: false });

test("same-order compatible stews share one row without crossing order boundaries", () => {
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
  assert.equal(groupKdsPotDisplayRows([pot(1, "흑돼지김치찌개"), { ...pot(2, "불고기김치찌개"), orderId: 99 }]).length, 2);
  assert.equal(groupKdsPotDisplayRows([pot(1, "흑돼지김치찌개", "WAITING", "TAKEOUT_PHONE"), pot(2, "불고기김치찌개", "WAITING", "TAKEOUT_PHONE")]).length, 2);
});

test("a configured addon task joins only its matching pot in the same order and state", () => {
  const pot = (taskId, orderId, compatibilityKey = "STEW") => ({
    ...task(taskId, 11, null), orderId, kind: "POT", compatibilityKey,
    startedAtMs: null, completionRequestScope: null, completionRequestId: null, completionRequestedAtMs: null,
    items: [{ name: "흑돼지김치찌개", kind: "POT", kdsKind: "POT", kdsGroupKey: compatibilityKey, qty: 1, options: [] }],
  });
  const addon = (taskId, orderId, groupKey = "STEW") => ({
    ...task(taskId, 11, null), orderId, kind: "SOLO", compatibilityKey: "MENU:old",
    startedAtMs: null, completionRequestScope: null, completionRequestId: null, completionRequestedAtMs: null,
    items: [{ name: "흑돼지추가", kind: "SOLO", kdsKind: "ADDON", kdsGroupKey: groupKey, qty: 1, options: [] }],
  });
  const rows = groupKdsPotDisplayRows([pot(1, 101), addon(2, 101)]);
  assert.deepEqual(rows.map(row => row.map(member => member.taskId)), [[1, 2]]);
  assert.deepEqual(formatKdsTaskDisplay("POT", rows[0].flatMap(member => member.items)).details, ["흑돼지추가"]);
  assert.equal(groupKdsPotDisplayRows([pot(1, 101), addon(2, 102)]).length, 2);
  assert.equal(groupKdsPotDisplayRows([pot(1, 101), addon(2, 101, "OTHER")]).length, 2);
  assert.equal(groupKdsPotDisplayRows([pot(1, 101), { ...addon(2, 101), status: "COOKING" }]).length, 2);
});

test("unkeyed addons join only a default or uniquely identifiable pot group", () => {
  const pot = (taskId, key) => ({
    ...task(taskId, 11, null), kind: "POT", compatibilityKey: key,
    startedAtMs: null, completionRequestScope: null, completionRequestId: null, completionRequestedAtMs: null,
    items: [{ name: `pot-${key}`, kind: "POT", kdsKind: "POT", kdsGroupKey: key, qty: 1, options: [] }],
  });
  const addon = { ...task(3, 11, null), kind: "SOLO", compatibilityKey: "MENU:old",
    startedAtMs: null, completionRequestScope: null, completionRequestId: null, completionRequestedAtMs: null,
    items: [{ name: "추가", kind: "SOLO", kdsKind: "ADDON", kdsGroupKey: null, qty: 1, options: [] }] };
  assert.deepEqual(groupKdsPotDisplayRows([pot(1, "STEW"), addon]).map(row => row.map(item => item.taskId)), [[1, 3]]);
  assert.deepEqual(groupKdsPotDisplayRows([pot(1, "STEW"), pot(2, "SOUP"), addon]).map(row => row.map(item => item.taskId)), [[1], [2], [3]]);
  assert.deepEqual(groupKdsPotDisplayRows([pot(1, "POT"), pot(2, "SOUP"), addon]).map(row => row.map(item => item.taskId)), [[1, 3], [2]]);
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
  assert.deepEqual(preparingKdsPartyCards(cards)[0].tables.map(table => table.tasks.map(item => item.taskId)), [[1, 2, 3], [4]]);
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

test("preparing keeps completed party tables visible while another table has reopened work", () => {
  const previousSessionDone = { ...task(1, 11, 7, "DONE"), orderId: 101 };
  const currentSessionWaiting = { ...task(2, 12, 7), orderId: 102 };
  const cards = groupKdsTasksByParty([previousSessionDone, currentSessionWaiting]);
  const visible = preparingKdsPartyCards(cards);
  assert.deepEqual(visible.map(card => card.tables.map(table => table.sessionId)), [[11, 12]]);
  assert.deepEqual(visible[0].tables.map(table => table.tasks.map(item => item.taskId)), [[1], [2]]);
});

test("preparing removes a party card only after every table task is complete", () => {
  const cards = groupKdsTasksByParty([
    task(1, 11, 7, "DONE"),
    task(2, 12, 7, "DONE"),
    task(3, 13, 7, "COOKING"),
  ]);
  assert.equal(preparingKdsPartyCards(cards).length, 1);
  assert.deepEqual(preparingKdsPartyCards(cards)[0].tables.map(table => table.sessionId), [11, 12, 13]);
  cards[0].tables[2].tasks[0].status = "DONE";
  assert.deepEqual(preparingKdsPartyCards(cards), []);
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

test("enabled order bundling groups one table across sessions while keeping task rows and IDs separate", () => {
  const first = { ...task(1, 101, null), orderId: 501, tableId: 8, orderedAtMs: 1_000, confirmedAtMs: 1_000 };
  const additionalSameSession = { ...task(2, 101, null), orderId: 502, tableId: 8, orderedAtMs: 91_000, confirmedAtMs: 91_000 };
  const additionalNewSession = { ...task(3, 102, null), orderId: 503, tableId: 8, orderedAtMs: 172_000, confirmedAtMs: 172_000 };
  const [bundle] = groupKdsTasksByParty([first, additionalSameSession, additionalNewSession], 180_000);
  assert.equal(bundle.key, "table:8:bundle:501");
  assert.deepEqual(bundle.tables.map(table => table.sessionId), [101, 102]);
  assert.deepEqual(bundle.tables.map(table => table.tasks.map(item => item.taskId)), [[1, 2], [3]]);
});

test("bundle anchor stays fixed and an order after its window starts a new outer card", () => {
  const make = (taskId, orderId, confirmedAtMs) => ({
    ...task(taskId, 101, null), orderId, tableId: 8, orderedAtMs: confirmedAtMs, confirmedAtMs,
  });
  const cards = groupKdsTasksByParty([
    make(1, 501, 0), make(2, 502, 170_000), make(3, 503, 181_000), make(4, 504, 200_000),
  ], 180_000);
  assert.deepEqual(cards.map(card => card.key), ["table:8:bundle:501", "table:8:bundle:503"]);
  assert.deepEqual(cards.map(card => card.tables[0].tasks.map(item => item.taskId)), [[1, 2], [3, 4]]);
});

test("orders on different physical tables remain separate, while existing party membership still groups them", () => {
  const make = (taskId, sessionId, tableId, groupId, confirmedAtMs) => ({
    ...task(taskId, sessionId, groupId), tableId, orderId: taskId + 100, orderedAtMs: confirmedAtMs, confirmedAtMs,
  });
  const standalone = groupKdsTasksByParty([make(1, 101, 8, null, 1_000), make(2, 102, 9, null, 2_000)], 180_000);
  assert.equal(standalone.length, 2);
  const party = groupKdsTasksByParty([make(1, 101, 8, 77, 1_000), make(2, 102, 9, 77, 2_000)], 180_000);
  assert.equal(party.length, 1);
  assert.equal(party[0].key, "party:77");
  assert.deepEqual(party[0].tables.map(table => table.sessionId), [101, 102]);
  const sameTablePartyAndNewSession = groupKdsTasksByParty([
    make(3, 103, 8, 77, 1_000), make(4, 104, 8, null, 60_000),
  ], 180_000);
  assert.equal(sameTablePartyAndNewSession.length, 1);
  assert.deepEqual(sameTablePartyAndNewSession[0].tables.map(table => table.sessionId), [103, 104]);
});

test("a bundle keeps its completed rows on preparing until every task in that bundle is done", () => {
  const done = { ...task(1, 101, null, "DONE"), tableId: 8, orderId: 501, confirmedAtMs: 1_000 };
  const waiting = { ...task(2, 102, null), tableId: 8, orderId: 502, confirmedAtMs: 60_000 };
  const [bundle] = groupKdsTasksByParty([done, waiting], 180_000);
  assert.equal(preparingKdsPartyCards([bundle]).length, 1);
  assert.deepEqual(preparingKdsPartyCards([bundle])[0].tables.map(table => table.tasks.map(item => item.taskId)), [[1], [2]]);
  waiting.status = "DONE";
  assert.equal(preparingKdsPartyCards([bundle]).length, 0);
});

test("order bundle uses server confirmation time and retains ordered time as a legacy fallback", () => {
  const first = { ...task(1, 101, null), tableId: 8, orderId: 501, orderedAtMs: 1_000, confirmedAtMs: 1_000 };
  const acceptedLater = { ...task(2, 102, null), tableId: 8, orderId: 502, orderedAtMs: 300_000, confirmedAtMs: 60_000 };
  const legacy = { ...task(3, 103, null), tableId: 8, orderId: 503, orderedAtMs: 120_000 };
  const cards = groupKdsTasksByParty([first, acceptedLater, legacy], 180_000);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].tables.map(table => table.tasks.map(item => item.taskId)), [[1], [2], [3]]);
});

test("hidden cancelled KDS orders still anchor bundle windows for visible tasks after refresh", () => {
  const rawOrders = [
    { ...task(1, 101, null), tableId: 8, orderId: 501, confirmedAtMs: 0 },
    { ...task(2, 101, null), tableId: 8, orderId: 502, confirmedAtMs: 170_000 },
    { ...task(3, 102, null), tableId: 8, orderId: 503, confirmedAtMs: 181_000 },
  ];
  const keys = buildKdsOrderBundleKeys(rawOrders, 180_000);
  const visible = [rawOrders[1], rawOrders[2]].map(order => ({
    ...order, orderBundleKey: keys.get(`${order.tableId}:${order.orderId}`),
  }));
  assert.deepEqual(groupKdsTasksByParty(visible, 180_000).map(card => card.key), [
    "table:8:bundle:501", "table:8:bundle:503",
  ]);
});

test("a separately confirmed addon in the same table bundle is display-only under its unique active pot", () => {
  const pot = { ...task(1, 101, 77), taskId: 1, orderId: 501, tableId: 8, orderBundleKey: "party:77",
    confirmedAtMs: 1_000, completedAtMs: null, kind: "POT", compatibilityKey: "STEW", startedAtMs: null,
    completionRequestScope: null, completionRequestId: null, completionRequestedAtMs: null,
    items: [{ itemId: 1, name: "김치찌개", qty: 1, kind: "POT", kdsKind: "POT", kdsGroupKey: "STEW", completionTimer: false, note: null, options: [] }] };
  const addon = { ...task(2, 102, 88), taskId: 2, orderId: 502, tableId: 8, orderBundleKey: "party:88",
    confirmedAtMs: 60_000, completedAtMs: null, kind: "SOLO", compatibilityKey: "MENU:old", startedAtMs: null,
    completionRequestScope: null, completionRequestId: null, completionRequestedAtMs: null,
    items: [{ itemId: 2, name: "꽁치추가", qty: 1, kind: "SOLO", kdsKind: "ADDON", kdsGroupKey: "STEW", completionTimer: false, note: null, options: [] }] };
  const linked = attachKdsOrderBundleAddons([pot, addon], 180_000);
  assert.deepEqual(linked[0].displayAddonItems.map(item => item.name), ["꽁치추가"]);
  assert.equal(linked[1].displayOnlyAsAddon, true);
  assert.deepEqual(groupKdsPotDisplayRows(linked).map(row => row.map(item => item.taskId)), [[1]]);
  assert.deepEqual(activeKdsTableTasks(linked).map(item => item.taskId), [1]);
  const cards = groupKdsTasksByParty(linked, 180_000);
  assert.equal(preparingKdsPartyCards(cards).length, 1);
  linked[0].status = "DONE";
  assert.equal(preparingKdsPartyCards(groupKdsTasksByParty(linked)).length, 0);
});

test("cross-session bundle renders one pot control and keeps both task states in lockstep", () => {
  const make = ({ taskId, orderId, sessionId, at, kind, status = "WAITING", changedAtMs = null }) => ({
    ...task(taskId, sessionId, null, status), taskId, orderId, tableId: 2, orderedAtMs: at, confirmedAtMs: at,
    completedAtMs: status === "DONE" ? changedAtMs : null, kind,
    compatibilityKey: kind === "POT" ? "STEW" : "MENU:tofu",
    startedAtMs: status === "COOKING" ? changedAtMs : null, changedAtMs,
    completionRequestScope: null, completionRequestId: null, completionRequestedAtMs: null,
    items: [{ itemId: taskId, name: kind === "POT" ? "흑돼지김치찌개" : "두부추가", qty: 1,
      kind: kind === "POT" ? "POT" : "SOLO", kdsKind: kind === "POT" ? "POT" : "ADDON",
      kdsGroupKey: "STEW", completionTimer: false, note: null, options: [] }],
  });
  const pot = make({ taskId: 21, orderId: 201, sessionId: 20, at: 1_000, kind: "POT" });
  const addon = make({ taskId: 22, orderId: 202, sessionId: 21, at: 60_000, kind: "SOLO" });
  const linked = attachKdsOrderBundleAddons([pot, addon], 180_000);
  const cards = preparingKdsPartyCards(groupKdsTasksByParty(linked, 180_000));
  const renderedTables = cards.flatMap(card => card.tables.filter(table => table.tasks.some(item => !item.displayOnlyAsAddon)));
  const controls = renderedTables.flatMap(table => groupKdsPotDisplayRows(table.tasks));

  assert.equal(renderedTables.length, 1);
  assert.equal(controls.length, 1);
  assert.equal(controls[0][0].taskId, pot.taskId);
  assert.deepEqual(controls[0][0].displayAddonItems.map(item => item.name), ["두부추가"]);
  assert.deepEqual(controls[0][0].displayAddonTaskIds, [addon.taskId]);

  const startedPot = transitionKdsLinkedAddonState({ status: "WAITING", cookingGroupId: null,
    cookingStartedAtMs: null, cookingCompletedAtMs: null, previousState: null, changedAtMs: null }, "START", 70_000);
  const startedAddon = transitionKdsLinkedAddonState({ status: "WAITING", cookingGroupId: null,
    cookingStartedAtMs: null, cookingCompletedAtMs: null, previousState: null, changedAtMs: null }, "START", 70_000);
  assert.equal(startedPot.status, startedAddon.status);
  assert.equal(startedPot.cookingStartedAtMs, startedAddon.cookingStartedAtMs);
  const completedPot = transitionKdsLinkedAddonState(startedPot, "COMPLETE", 80_000);
  const completedAddon = transitionKdsLinkedAddonState(startedAddon, "COMPLETE", 80_000);
  assert.equal(completedPot.status, "DONE");
  assert.equal(completedAddon.status, completedPot.status);
  assert.equal(completedAddon.cookingCompletedAtMs, completedPot.cookingCompletedAtMs);
});

test("bundle addon stays separate when pot completed before arrival or target is ambiguous", () => {
  const make = (taskId, orderId, confirmedAtMs, kind, status = "WAITING") => ({
    ...task(taskId, 101, null, status), taskId, orderId, tableId: 8, orderBundleKey: "table:8:bundle:501",
    confirmedAtMs, completedAtMs: status === "DONE" ? confirmedAtMs : null,
    kind, compatibilityKey: kind === "POT" ? "STEW" : "MENU:old", startedAtMs: null,
    completionRequestScope: null, completionRequestId: null, completionRequestedAtMs: null,
    items: [{ itemId: taskId, name: kind === "POT" ? `pot-${taskId}` : "꽁치추가", qty: 1,
      kind: kind === "POT" ? "POT" : "SOLO", kdsKind: kind === "POT" ? "POT" : "ADDON",
      kdsGroupKey: "STEW", completionTimer: false, note: null, options: [] }],
  });
  const addon = make(2, 502, 60_000, "SOLO");
  const completedBeforeArrival = make(1, 501, 1_000, "POT", "DONE");
  assert.equal(attachKdsOrderBundleAddons([completedBeforeArrival, addon], 180_000)[1].displayOnlyAsAddon, false);
  const activePot = { ...completedBeforeArrival, status: "COOKING", completedAtMs: null };
  const secondPot = { ...activePot, taskId: 3, orderId: 503, confirmedAtMs: 30_000 };
  assert.equal(attachKdsOrderBundleAddons([activePot, secondPot, addon], 180_000)[2].displayOnlyAsAddon, false);
});

test("stew addon matching uses the fixed table-time bundle, not party-promoted card keys", () => {
  const make = ({ taskId, orderId, sessionId, groupId, at, kind, status = "WAITING", compatibilityKey = "STEW", completedAtMs = null }) => ({
    ...task(taskId, sessionId, groupId, status), taskId, orderId, tableId: 10,
    orderedAtMs: at, confirmedAtMs: at, completedAtMs,
    orderBundleKey: groupId === null ? `table:10:bundle:${orderId}` : `party:${groupId}`,
    kind, compatibilityKey, startedAtMs: status === "COOKING" ? 10_000 : null,
    completionRequestScope: null, completionRequestId: null, completionRequestedAtMs: null,
    items: [{ itemId: taskId, name: kind === "POT" ? "흑돼지김치찌개" : "목살추가", qty: 1,
      kind: kind === "POT" ? "POT" : "SOLO", kdsKind: kind === "POT" ? "POT" : "ADDON",
      kdsGroupKey: "STEW", completionTimer: false, note: null, options: [] }],
  });
  const pot = make({ taskId: 1, orderId: 501, sessionId: 100, groupId: 71, at: 1_000, kind: "POT", status: "COOKING" });
  const addon = make({ taskId: 2, orderId: 502, sessionId: 101, groupId: 72, at: 60_000, kind: "SOLO" });
  const timeKeys = buildKdsTableOrderBundleKeys([pot, addon], 180_000);
  assert.equal(timeKeys.get("10:501"), timeKeys.get("10:502"));
  const linked = attachKdsOrderBundleAddons([pot, addon], 180_000);
  assert.deepEqual(linked[0].displayAddonItems.map(item => item.itemId), [2]);
  assert.equal(linked[1].displayOnlyAsAddon, true);
  assert.deepEqual(groupKdsPotDisplayRows(linked).map(row => row.map(item => item.taskId)), [[1]]);
  assert.equal(linked[0].status, "COOKING");
  assert.equal(linked[1].status, "WAITING"); // Display grouping is pure; persistence transitions happen in the KDS action transaction.

  const lateAddon = make({ taskId: 3, orderId: 503, sessionId: 102, groupId: 71, at: 181_001, kind: "SOLO" });
  assert.equal(attachKdsOrderBundleAddons([pot, lateAddon], 180_000)[1].displayOnlyAsAddon, false);
});

test("order bundle settings default to OFF with a three-minute value and validate bounded minutes", () => {
  assert.deepEqual(DEFAULT_KDS_ORDER_BUNDLE_SETTINGS, { enabled: false, minutes: 3 });
  assert.equal(isKdsOrderBundleSettings({ enabled: true, minutes: 3 }), true);
  assert.equal(isKdsOrderBundleSettings({ enabled: false, minutes: 60 }), true);
  assert.equal(isKdsOrderBundleSettings({ enabled: true, minutes: 0 }), false);
  assert.equal(isKdsOrderBundleSettings({ enabled: true, minutes: 3.5 }), false);
  assert.equal(isKdsOrderBundleSettings({ enabled: "ON", minutes: 3 }), false);
});

test("linked cross-session addon follows start, undo, and completion without replacing its own history", () => {
  const waiting = { status: "WAITING", cookingGroupId: null, cookingStartedAtMs: null,
    cookingCompletedAtMs: null, previousState: null, changedAtMs: 100 };
  const started = transitionKdsLinkedAddonState(waiting, "START", 200);
  assert.equal(started.status, "COOKING");
  assert.equal(started.cookingStartedAtMs, 200);
  assert.equal(started.previousState.status, "WAITING");
  assert.equal(started.changedAtMs, 200);

  const undone = transitionKdsLinkedAddonState(started, "UNDO_START", 300);
  assert.equal(undone.status, "WAITING");
  assert.equal(undone.previousState.status, "COOKING");
  assert.equal(undone.changedAtMs, 300);

  const restarted = transitionKdsLinkedAddonState(undone, "START", 400);
  const completed = transitionKdsLinkedAddonState(restarted, "COMPLETE", 500);
  assert.equal(completed.status, "DONE");
  assert.equal(completed.cookingCompletedAtMs, 500);
  assert.equal(completed.previousState.status, "COOKING");
  const restored = transitionKdsLinkedAddonState(completed, "UNDO_COMPLETE", 550);
  assert.equal(restored.status, "COOKING");
  assert.equal(restored.cookingCompletedAtMs, null);
  assert.equal(transitionKdsLinkedAddonState(completed, "START", 600), null);
});

test("a separately completed add-on remains hidden under its completed pot only when completion follows arrival", () => {
  const make = (taskId, orderId, confirmedAtMs, kind, status, completedAtMs) => ({
    ...task(taskId, orderId, null, status), taskId, orderId, tableId: 10,
    orderedAtMs: confirmedAtMs, confirmedAtMs, completedAtMs,
    kind, compatibilityKey: kind === "POT" ? "STEW" : "MENU:old", startedAtMs: confirmedAtMs,
    orderBundleKey: "table:10:bundle:100",
    items: [{ itemId: taskId, name: kind === "POT" ? "pot" : "addon", qty: 1,
      kind: kind === "POT" ? "POT" : "SOLO", kdsKind: kind === "POT" ? "POT" : "ADDON",
      kdsGroupKey: "STEW", completionTimer: false, note: null, options: [] }],
  });
  const pot = make(1, 100, 1_000, "POT", "DONE", 70_000);
  const addon = make(2, 101, 60_000, "SOLO", "DONE", 70_000);
  const linked = attachKdsOrderBundleAddons([pot, addon], 180_000);
  assert.equal(linked[1].displayOnlyAsAddon, true);
  assert.deepEqual(linked[0].displayAddonTaskIds, [2]);
  assert.equal(preparingKdsPartyCards(groupKdsTasksByParty(linked, 180_000)).length, 0);

  const potCompletedTooEarly = make(3, 100, 1_000, "POT", "DONE", 50_000);
  assert.equal(attachKdsOrderBundleAddons([potCompletedTooEarly, addon], 180_000)[1].displayOnlyAsAddon, false);

  const unfinishedAddon = make(4, 101, 60_000, "SOLO", "WAITING", null);
  const stale = attachKdsOrderBundleAddons([pot, unfinishedAddon], 180_000);
  assert.equal(stale[1].displayOnlyAsAddon, false);
  assert.equal(preparingKdsPartyCards(groupKdsTasksByParty(stale, 180_000)).length, 1);

  const pendingPot = { ...pot, status: "COOKING", completedAtMs: null, completionRequestedAtMs: 69_000 };
  assert.equal(attachKdsOrderBundleAddons([pendingPot, unfinishedAddon], 180_000)[1].displayOnlyAsAddon, false);
});
