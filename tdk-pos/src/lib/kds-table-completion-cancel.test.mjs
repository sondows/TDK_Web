import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as model from "./kds-model.ts";
import * as grouping from "./kds-party-grouping.ts";

const nativeRequire = createRequire(import.meta.url);

function loadProductionModule(path, mocks) {
  const source = readFileSync(resolve(import.meta.dirname, path), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loadedModule = { exports: {} };
  runInNewContext(compiled, {
    module: loadedModule, exports: loadedModule.exports, Date, console, setTimeout, Response, Request,
    require: name => name in mocks ? mocks[name] : nativeRequire(name),
  }, { filename: path });
  return loadedModule.exports;
}

function cancellationFixture({ queryDelayMs = 0, requestAgeMs = 1000 } = {}) {
  const sessionId = 12;
  const requestId = "table-request-12";
  const requestedAtMs = Date.now() - requestAgeMs;
  const startAtMs = requestedAtMs - 120_000;
  const previous = {
    status: "COOKING", cookingGroupId: 9, cookingStartedAtMs: startAtMs,
    cookingCompletedAtMs: null,
    completionRequest: {
      scope: "TABLE", requestId, sessionId, requestedAtMs,
      completionCountdownSeconds: 3, expectedStatus: "COOKING",
      expectedChangedAtMs: startAtMs, postCookTimerMinutes: 5,
    },
  };
  const row = { taskId: 31, status: "COOKING", previousState: JSON.stringify(previous),
    memberItems: JSON.stringify([{ itemId: 42, kind: "POT" }]), cookingGroupId: 9,
    cookingStartedAtMs: startAtMs, cookingCompletedAtMs: null, changedAtMs: startAtMs };
  const calls = { queries: [], updates: [], commits: 0, rollbacks: 0, releases: 0 };
  const connection = {
    async beginTransaction() {},
    async query(sql) {
      calls.queries.push(sql);
      if (sql.includes("FROM table_sessions")) return [[{ status: "OPEN" }]];
      if (sql.includes("FROM order_items oi")) return [[{
        itemId: 42, parentItemId: null, timerEligible: 1, kdsKind: "POT", kdsVisible: 1,
        itemStatus: "OPEN", remaining: 2, orderStatus: "OPEN", sessionStatus: "OPEN",
      }]];
      if (queryDelayMs) await new Promise(resolve => setTimeout(resolve, queryDelayMs));
      return [[row]];
    },
    async execute(sql, params) {
      calls.updates.push({ sql, params });
      if (sql.includes("SET previous_state")) row.previousState = params[0];
      if (sql.includes("SET status='DONE'")) {
        row.status = "DONE";
        row.cookingCompletedAtMs = params[0];
        row.previousState = params[1];
      }
      return [{ affectedRows: 1 }];
    },
    async commit() { calls.commits++; },
    async rollback() { calls.rollbacks++; },
    release() { calls.releases++; },
  };
  const server = loadProductionModule("kds-server.ts", {
    "server-only": {}, "@/db": { pool: { getConnection: async () => connection } },
    "@/lib/kds-model": model,
    "@/lib/kds-party-grouping": grouping,
  });
  const route = loadProductionModule("../app/api/kitchen/tables/[sessionId]/complete/route.ts", {
    "@/lib/kds-auth": { getCurrentKdsStaff: async () => ({ id: 1 }) },
    "@/lib/kds-model": model,
    "@/lib/kds-server": server,
    "@/lib/kds-cooking-settings": { getKdsCookingSettings: async () => ({}) },
    "@/lib/kds-completion-countdown-setting": { getKdsCompletionCountdownSeconds: async () => 3 },
  });
  const action = (name, extra = {}) => route.POST(new Request(`http://localhost/api/kitchen/tables/${sessionId}/complete`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: name, requestId, requestedAtMs, ...extra }),
  }), { params: Promise.resolve({ sessionId: String(sessionId) }) });
  return { cancel: () => action("CANCEL"), finalize: extra => action("FINALIZE", extra),
    row, calls, previous, startAtMs };
}

function multiTaskFinalizeFixture({ changedTaskId = null, requestAgeMs = 5000, missingTaskId = null } = {}) {
  const sessionId = 12;
  const requestId = "table-pot-request";
  const requestedAtMs = Date.now() - requestAgeMs;
  const startedAtMs = requestedAtMs - 120_000;
  const expectedTaskIds = [31, 32];
  const rows = [31, 32].map((taskId, index) => ({
    taskId, status: "COOKING", memberItems: JSON.stringify([{ itemId: 42 + index, kind: index ? "ADDON" : "POT" }]),
    cookingGroupId: 9, cookingStartedAtMs: startedAtMs, cookingCompletedAtMs: null,
    changedAtMs: changedTaskId === taskId ? startedAtMs - 1 : startedAtMs,
    previousState: JSON.stringify({ status: "COOKING", cookingGroupId: 9, cookingStartedAtMs: startedAtMs,
      cookingCompletedAtMs: null, completionRequest: { scope: "TABLE", requestId, sessionId, requestedAtMs,
        completionCountdownSeconds: 3, expectedStatus: "COOKING", expectedChangedAtMs: startedAtMs,
        expectedTaskIds, postCookTimerMinutes: index ? null : 5 } }),
  }));
  const calls = { updates: [], commits: 0, rollbacks: 0, releases: 0 };
  const connection = {
    async beginTransaction() {},
    async query(sql) {
      if (sql.includes("FROM table_sessions")) return [[{ status: "OPEN" }]];
      if (sql.includes("FROM order_items oi")) return [[42, 43].map((itemId, index) => ({
        itemId, parentItemId: null, timerEligible: index ? 0 : 1, kdsKind: index ? "ADDON" : "POT",
        kdsVisible: 1, itemStatus: "OPEN", remaining: 1, orderStatus: "OPEN", sessionStatus: "OPEN",
      }))];
      if (sql.includes("FROM kds_tasks k INNER JOIN orders o")) return [rows.filter(row => row.taskId !== missingTaskId)];
      return [[]];
    },
    async execute(sql, params) {
      calls.updates.push({ sql, params });
      const taskId = Number(sql.includes("SET status='DONE'") ? params[5] : params[1]);
      const row = rows.find(item => item.taskId === taskId);
      if (sql.includes("SET previous_state")) row.previousState = params[0];
      if (sql.includes("SET status='DONE'")) {
        row.status = "DONE";
        row.cookingCompletedAtMs = params[0];
        row.previousState = params[1];
      }
      return [{ affectedRows: 1 }];
    },
    async commit() { calls.commits++; },
    async rollback() { calls.rollbacks++; },
    release() { calls.releases++; },
  };
  const server = loadProductionModule("kds-server.ts", {
    "server-only": {}, "@/db": { pool: { getConnection: async () => connection } },
    "@/lib/kds-model": model,
    "@/lib/kds-party-grouping": grouping,
  });
  return { finalize: () => server.finalizeKdsTableCompletion(sessionId, requestId, requestedAtMs), rows, calls, expectedTaskIds };
}

function tableCompletionRequestFixture() {
  const sessionId = 9;
  const changedAtMs = Date.now() - 120_000;
  const rows = [
    { taskId: 41, kind: "POT", itemId: 501, timerEligible: 1, kdsKind: "POT" },
    { taskId: 42, kind: "POT", itemId: 502, timerEligible: 1, kdsKind: "POT" },
    { taskId: 43, kind: "SOLO", itemId: 503, timerEligible: 0, kdsKind: "ADDON" },
    { taskId: 44, kind: "SOLO", itemId: 504, timerEligible: 0, kdsKind: "SOLO" },
  ].map(({ itemId, timerEligible, kdsKind, ...task }) => ({
    ...task, orderId: 100 + task.taskId, memberItems: JSON.stringify([{ itemId, kind: task.kind === "POT" ? "POT" : "NORMAL" }]),
    compatibilityKey: task.kind, status: "COOKING", cookingGroupId: 7, cookingStartedAtMs: changedAtMs,
    cookingCompletedAtMs: null, changedAtMs, timerEligible, kdsKind, kdsVisible: 1,
    itemStatus: "OPEN", remaining: 1, orderStatus: "OPEN", sessionStatus: "OPEN",
    previousState: JSON.stringify({ status: "COOKING", cookingGroupId: 7, cookingStartedAtMs: changedAtMs,
      cookingCompletedAtMs: null }),
  }));
  const calls = { updates: [], commits: 0, rollbacks: 0, releases: 0 };
  const connection = {
    async beginTransaction() {},
    async query(sql) {
      if (sql.includes("FROM table_sessions")) return [[{ sessionKind: "DINE_IN", status: "OPEN", tableId: 9 }]];
      if (sql.includes("FROM kds_tasks k INNER JOIN orders o")) return [rows.filter(row => row.status !== "DONE")];
      if (sql.includes("FROM order_items oi")) return [[...rows.map(row => ({
        itemId: row.memberItems && JSON.parse(row.memberItems)[0].itemId, parentItemId: null,
        timerEligible: row.timerEligible, kdsKind: row.kdsKind, kdsVisible: row.kdsVisible,
        itemStatus: row.itemStatus, remaining: row.remaining, orderStatus: row.orderStatus, sessionStatus: row.sessionStatus,
      }))]];
      throw new Error(`Unexpected table completion query: ${sql.slice(0, 80)}`);
    },
    async execute(sql, params) {
      calls.updates.push({ sql, params });
      const taskId = Number(sql.includes("SET status='DONE'") ? params[5] : params[1]);
      const row = rows.find(item => item.taskId === taskId);
      if (sql.includes("SET previous_state")) row.previousState = params[0];
      if (sql.includes("SET status='DONE'")) {
        row.status = "DONE"; row.cookingCompletedAtMs = params[0]; row.previousState = params[1];
      }
      return [{ affectedRows: 1 }];
    },
    async commit() { calls.commits++; },
    async rollback() { calls.rollbacks++; },
    release() { calls.releases++; },
  };
  const server = loadProductionModule("kds-server.ts", {
    "server-only": {}, "@/db": { pool: { getConnection: async () => connection } },
    "@/lib/kds-model": model, "@/lib/kds-party-grouping": grouping,
  });
  return { server, rows, calls, sessionId, changedAtMs };
}

test("real table CANCEL API clears pending state without completing cooking", async () => {
  const { cancel, row, calls, startAtMs } = cancellationFixture();
  const response = await cancel();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).cancelled, true);
  assert.equal(row.status, "COOKING");
  assert.equal(JSON.parse(row.previousState).cookingStartedAtMs, startAtMs);
  assert.equal(JSON.parse(row.previousState).completionRequest, undefined);
  assert.equal(calls.commits, 1);
  assert.equal(calls.rollbacks, 0);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates.some(call => call.sql.includes("status='DONE'")), false);
});

test("ten table CANCEL requests leave no pending countdown or completion update", async () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { cancel, row, calls } = cancellationFixture();
    assert.equal((await (await cancel()).json()).cancelled, true);
    assert.equal(JSON.parse(row.previousState).completionRequest, undefined);
    assert.equal(calls.updates.length, 1);
    assert.equal(calls.rollbacks, 0);
  }
});

test("delayed table CANCEL response still clears the server countdown", async () => {
  const { cancel, row, calls } = cancellationFixture({ queryDelayMs: 200 });
  const response = await cancel();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).cancelled, true);
  assert.equal(JSON.parse(row.previousState).completionRequest, undefined);
  assert.equal(calls.updates.some(call => call.sql.includes("status='DONE'")), false);
});

test("a FINALIZE request after CANCEL cannot complete the old countdown", async () => {
  const { cancel, finalize, row, calls } = cancellationFixture();
  assert.equal((await (await cancel()).json()).cancelled, true);
  const response = await finalize({ immediate: true });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).completed, 0);
  assert.equal(row.status, "COOKING");
  assert.equal(calls.updates.some(call => call.sql.includes("status='DONE'")), false);
});

test("an early FINALIZE API response identifies a pending countdown instead of implying a task-configuration change", async () => {
  const { finalize, row, calls } = cancellationFixture({ requestAgeMs: 1000 });
  const response = await finalize();
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.success, true);
  assert.equal(result.completed, 0);
  assert.equal(result.outcome, "COUNTDOWN_PENDING");
  assert.ok(result.finalizeAtMs > result.serverNowMs);
  assert.equal(row.status, "COOKING");
  assert.equal(calls.updates.length, 0);
});

test("an uncancelled countdown reaches the real FINALIZE path once", async () => {
  const { finalize, row, calls } = cancellationFixture({ requestAgeMs: 5000 });
  const response = await finalize();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).completed, 1);
  assert.equal(row.status, "DONE");
  assert.equal(calls.updates.filter(call => call.sql.includes("SET status='DONE'")).length, 1);
});

test("a repeated FINALIZE confirms the exact committed request instead of returning REQUEST_NOT_FOUND", async () => {
  const { finalize, row, calls } = cancellationFixture({ requestAgeMs: 5000 });
  const first = await (await finalize()).json();
  const secondResponse = await finalize();
  const second = await secondResponse.json();
  assert.equal(first.outcome, "COMPLETED");
  assert.equal(secondResponse.status, 200);
  assert.equal(second.outcome, "ALREADY_COMPLETED");
  assert.equal(second.alreadyCompleted, true);
  assert.deepEqual(second.expectedTaskIds, [31]);
  assert.deepEqual(second.actualTaskIds, [31]);
  assert.equal(row.status, "DONE");
  assert.deepEqual(JSON.parse(row.previousState).completedTableRequest.expectedTaskIds, [31]);
  assert.equal(calls.updates.filter(call => call.sql.includes("SET status='DONE'")).length, 1);
});

test("CANCEL after the rollback window reports verified completion without undoing or erroring", async () => {
  const { finalize, cancel, row, calls } = cancellationFixture({ requestAgeMs: 5000 });
  await finalize();
  const previous = JSON.parse(row.previousState);
  previous.completedTableRequest.confirmedAtMs = Date.now() - 6000;
  row.previousState = JSON.stringify(previous);
  const response = await cancel();
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.alreadyCompleted, true);
  assert.equal(result.cancelled, false);
  assert.equal(result.outcome, "ALREADY_COMPLETED");
  assert.equal(row.status, "DONE");
  assert.equal(calls.updates.filter(call => call.sql.includes("SET status='DONE'")).length, 1);
  assert.equal(calls.updates.filter(call => call.sql.includes("SET status='COOKING'")).length, 0);
});

test("a pot and its attached add-on finalize together in one table transaction", async () => {
  const { finalize, rows, calls } = multiTaskFinalizeFixture();
  const result = await finalize();
  assert.equal(result.completed, 2);
  assert.deepEqual(Array.from(result.expectedTaskIds), [31, 32]);
  assert.deepEqual(Array.from(result.actualTaskIds), [31, 32]);
  assert.equal(result.outcome, "COMPLETED");
  assert.deepEqual(rows.map(row => row.status), ["DONE", "DONE"]);
  assert.equal(rows[0].cookingCompletedAtMs, rows[1].cookingCompletedAtMs);
  assert.equal(calls.updates.filter(call => call.sql.includes("SET status='DONE'")).length, 2);
  assert.equal(calls.commits, 1);
  assert.equal(calls.rollbacks, 0);
});

test("a repeated grouped finalize verifies the same completed task set without issuing updates again", async () => {
  const { finalize, rows, calls, expectedTaskIds } = multiTaskFinalizeFixture();
  const first = await finalize();
  const second = await finalize();
  assert.equal(first.outcome, "COMPLETED");
  assert.equal(second.outcome, "ALREADY_COMPLETED");
  assert.equal(second.alreadyCompleted, true);
  assert.deepEqual(Array.from(second.expectedTaskIds), expectedTaskIds);
  assert.deepEqual(Array.from(second.actualTaskIds), expectedTaskIds);
  assert.deepEqual(rows.map(row => row.status), ["DONE", "DONE"]);
  assert.equal(calls.updates.filter(call => call.sql.includes("SET status='DONE'")).length, 2);
});

test("a table completion request persists its exact server task ID snapshot on every selected task", async () => {
  const sessionId = 12;
  const taskIds = [31, 32];
  const changedAtMs = Date.now() - 10_000;
  const rows = taskIds.map((taskId, index) => ({
    taskId, orderId: 100 + index,
    memberItems: JSON.stringify([{ itemId: 42 + index, kind: "POT" }]),
    kind: "POT", compatibilityKey: "POT", status: "COOKING", cookingGroupId: 9,
    cookingStartedAtMs: changedAtMs, cookingCompletedAtMs: null,
    previousState: JSON.stringify({ status: "WAITING", cookingGroupId: null,
      cookingStartedAtMs: null, cookingCompletedAtMs: null }), changedAtMs,
  }));
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql) {
      if (sql.includes("FROM table_sessions")) return [[{ sessionKind: "DINE_IN", status: "OPEN", tableId: 4 }]];
      if (sql.includes("FROM kds_tasks k INNER JOIN orders o")) return [rows];
      if (sql.includes("FROM order_items oi")) return [[42, 43].map(itemId => ({
        itemId, parentItemId: null, timerEligible: 0, kdsKind: "POT", kdsVisible: 1,
        itemStatus: "ACTIVE", remaining: 1, orderStatus: "CONFIRMED", sessionStatus: "OPEN",
      }))];
      throw new Error(`Unexpected table completion query: ${sql.slice(0, 80)}`);
    },
    async execute(_sql, params) {
      const row = rows.find(item => item.taskId === Number(params[1]));
      row.previousState = params[0];
      return [{ affectedRows: 1 }];
    },
  };
  const server = loadProductionModule("kds-server.ts", {
    "server-only": {}, "@/db": { pool: { getConnection: async () => connection } },
    "@/lib/kds-model": model, "@/lib/kds-party-grouping": grouping,
  });
  const result = await server.requestKdsTableCompletion(sessionId, taskIds.map(taskId => ({
    taskId, status: "COOKING", changedAtMs,
  })), 5, 3, false);
  assert.equal(result.taskCount, 2);
  assert.deepEqual(rows.map(row => JSON.parse(row.previousState).completionRequest.expectedTaskIds), [taskIds, taskIds]);
});

test("one whole-table request snapshots and atomically finalizes cooking pots, linked addon, and solo tasks", async () => {
  const { server, rows, calls, sessionId, changedAtMs } = tableCompletionRequestFixture();
  const requested = await server.requestKdsTableCompletion(sessionId, rows.map(row => ({
    taskId: row.taskId, status: row.status, changedAtMs: row.changedAtMs,
  })), 5, 3, false);
  const expectedIds = [41, 42, 43, 44];
  assert.equal(requested.taskCount, expectedIds.length);
  assert.deepEqual(rows.map(row => JSON.parse(row.previousState).completionRequest.expectedTaskIds),
    Array.from({ length: expectedIds.length }, () => expectedIds));
  assert.deepEqual(rows.map(row => JSON.parse(row.previousState).completionRequest.postCookTimerMinutes), [5, 5, null, null]);

  const finalized = await server.finalizeKdsTableCompletion(sessionId, requested.requestId, requested.requestedAtMs, true);
  assert.equal(finalized.outcome, "COMPLETED");
  assert.equal(finalized.completed, expectedIds.length);
  assert.deepEqual(Array.from(finalized.expectedTaskIds), expectedIds);
  assert.deepEqual(Array.from(finalized.actualTaskIds), expectedIds);
  assert.deepEqual(rows.map(row => row.status), expectedIds.map(() => "DONE"));
  assert.deepEqual(rows.map(row => row.previousState && JSON.parse(row.previousState).completedTableRequest?.requestId),
    expectedIds.map(() => requested.requestId));
  assert.equal(calls.updates.filter(call => call.sql.includes("SET status='DONE'")).length, expectedIds.length);
  assert.equal(calls.commits, 2);
  assert.equal(calls.rollbacks, 0);
  assert.ok(changedAtMs < requested.requestedAtMs);
});

test("a changed member cancels the whole pot completion request without partial completion", async () => {
  const { finalize, rows, calls } = multiTaskFinalizeFixture({ changedTaskId: 32 });
  const result = await finalize();
  assert.equal(result.completed, 0);
  assert.equal(result.outcome, "TASK_STATE_CHANGED");
  assert.deepEqual(Array.from(result.expectedTaskIds), [31, 32]);
  assert.deepEqual(Array.from(result.actualTaskIds), [31, 32]);
  assert.deepEqual(rows.map(row => row.status), ["COOKING", "COOKING"]);
  assert.equal(rows.every(row => JSON.parse(row.previousState).completionRequest === undefined), true);
  assert.equal(calls.updates.some(call => call.sql.includes("SET status='DONE'")), false);
  assert.equal(calls.commits, 1);
  assert.equal(calls.rollbacks, 0);
});

test("an early table finalize reports countdown pending, not changed composition, with the exact task snapshot", async () => {
  const { finalize, rows, calls, expectedTaskIds } = multiTaskFinalizeFixture({ requestAgeMs: 1000 });
  const result = await finalize();
  assert.equal(result.completed, 0);
  assert.equal(result.outcome, "COUNTDOWN_PENDING");
  assert.ok(result.finalizeAtMs > result.serverNowMs);
  assert.deepEqual(Array.from(result.expectedTaskIds), expectedTaskIds);
  assert.deepEqual(Array.from(result.actualTaskIds), expectedTaskIds);
  assert.deepEqual(rows.map(row => row.status), ["COOKING", "COOKING"]);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.commits, 1);
});

test("a missing task ID in a pot snapshot cancels the completion atomically and reports expected versus actual IDs", async () => {
  const { finalize, rows, calls } = multiTaskFinalizeFixture({ missingTaskId: 32 });
  const result = await finalize();
  assert.equal(result.completed, 0);
  assert.equal(result.outcome, "TASK_SET_CHANGED");
  assert.deepEqual(Array.from(result.expectedTaskIds), [31, 32]);
  assert.deepEqual(Array.from(result.actualTaskIds), [31]);
  assert.deepEqual(rows.map(row => row.status), ["COOKING", "COOKING"]);
  assert.equal(calls.updates.some(call => call.sql.includes("SET status='DONE'")), false);
  assert.equal(calls.commits, 1);
});
