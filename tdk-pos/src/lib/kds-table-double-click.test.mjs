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
  runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports, Date, console, setTimeout, Response, Request,
    require: name => name in mocks ? mocks[name] : nativeRequire(name) }, { filename: path });
  return loadedModule.exports;
}

function fixture(initial = [
  { taskId: 41, itemId: 501, kind: "POT", status: "WAITING", changedAtMs: 1000,
    cookingGroupId: null, cookingStartedAtMs: null, cookingCompletedAtMs: null, postCookTimerMinutes: null,
    postCookTimerStartedAtMs: null, previousState: null, timerEligible: 1, kdsKind: "POT" },
  { taskId: 42, itemId: 502, kind: "SOLO", status: "COOKING", changedAtMs: 2000,
    cookingGroupId: 9, cookingStartedAtMs: 1500, cookingCompletedAtMs: null, postCookTimerMinutes: null,
    postCookTimerStartedAtMs: null, previousState: JSON.stringify({ status: "WAITING", cookingGroupId: null,
      cookingStartedAtMs: null, cookingCompletedAtMs: null, bulkStartId: "prior-start" }), timerEligible: 0, kdsKind: "SOLO" },
  { taskId: 43, itemId: 503, kind: "SOLO", status: "WAITING", changedAtMs: 1100,
    cookingGroupId: null, cookingStartedAtMs: null, cookingCompletedAtMs: null, postCookTimerMinutes: null,
    postCookTimerStartedAtMs: null, previousState: null, timerEligible: 0, kdsKind: "ADDON" },
]) {
  const sessionId = 9;
  const rows = initial.map(row => ({ ...row, orderId: 100 + row.taskId, compatibilityKey: row.kind,
    memberItems: JSON.stringify([{ itemId: row.itemId, kind: row.kind }]),
    orderStatus: "OPEN", sessionStatus: "OPEN", itemStatus: "OPEN", remaining: 1, kdsVisible: 1 }));
  const calls = { updates: [], commits: 0, rollbacks: 0, releases: 0 };
  const connection = {
    async beginTransaction() {},
    async query(sql, params = []) {
      if (sql.includes("FROM table_sessions")) return [[{ sessionKind: "DINE_IN", status: "OPEN", tableId: 9 }]];
      if (sql.includes("FROM kds_tasks k INNER JOIN orders o")) {
        return [sql.includes("k.status<>'DONE'") ? rows.filter(row => row.status !== "DONE") : rows];
      }
      if (sql.includes("FROM order_items oi")) {
        const ids = Array.isArray(params[0]) ? params[0] : [];
        return [ids.map(itemId => {
          const row = rows.find(candidate => candidate.itemId === Number(itemId));
          return { itemId: Number(itemId), parentItemId: null, timerEligible: row?.timerEligible ?? 0,
            kdsKind: row?.kdsKind ?? "NONE", kdsVisible: row?.kdsVisible ?? 1,
            itemStatus: row?.itemStatus ?? "OPEN", remaining: row?.remaining ?? 1,
            orderStatus: row?.orderStatus ?? "OPEN", sessionStatus: row?.sessionStatus ?? "OPEN" };
        })];
      }
      throw new Error("Unexpected query: " + sql);
    },
    async execute(sql, params) {
      calls.updates.push({ sql, params });
      let row;
      if (sql.includes("SET status='DONE'")) {
        row = rows.find(item => Number(item.taskId) === Number(params[5]));
        Object.assign(row, { status: "DONE", cookingCompletedAtMs: params[0], previousState: params[1],
          changedAtMs: params[2], postCookTimerMinutes: params[3], postCookTimerStartedAtMs: params[4] });
      } else if (sql.includes("SET status=?,cooking_group_id")) {
        row = rows.find(item => Number(item.taskId) === Number(params[8]));
        Object.assign(row, { status: params[0], cookingGroupId: params[1], cookingStartedAtMs: params[2],
          cookingCompletedAtMs: params[3], previousState: params[4], changedAtMs: params[5],
          postCookTimerMinutes: params[6], postCookTimerStartedAtMs: params[7] });
      } else if (sql.includes("SET status='COOKING'")) {
        row = rows.find(item => Number(item.taskId) === Number(params[3]));
        Object.assign(row, { status: "COOKING", cookingStartedAtMs: params[0], cookingCompletedAtMs: null,
          previousState: params[1], changedAtMs: params[2], postCookTimerMinutes: null, postCookTimerStartedAtMs: null });
      } else if (sql.includes("SET previous_state")) {
        row = rows.find(item => Number(item.taskId) === Number(params[1]));
        if (row) row.previousState = params[0];
      }
      return [{ affectedRows: row ? 1 : 0 }];
    },
    async commit() { calls.commits++; },
    async rollback() { calls.rollbacks++; },
    release() { calls.releases++; },
  };
  const server = loadProductionModule("kds-server.ts", {
    "server-only": {}, "@/db": { pool: { getConnection: async () => connection } },
    "@/lib/kds-model": model, "@/lib/kds-party-grouping": grouping,
  });
  const route = loadProductionModule("../app/api/kitchen/tables/[sessionId]/complete/route.ts", {
    "@/lib/kds-auth": { getCurrentKdsStaff: async () => ({ staffId: 1 }) },
    "@/lib/kds-model": model, "@/lib/kds-server": server,
    "@/lib/kds-cooking-settings": { getKdsCookingSettings: async () => ({
      defaultBoilTimeMinutes: 5, boilTimeOptions: [10, 5, 3],
    }) },
    "@/lib/kds-completion-countdown-setting": { getKdsCompletionCountdownSeconds: async () => 3 },
  });
  const request = async (action, tasks = rows.map(row => ({ taskId: row.taskId, status: row.status, changedAtMs: row.changedAtMs })) ) => {
    const response = await route.POST(new Request("http://localhost/api/kitchen/tables/" + sessionId + "/complete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, tasks }),
    }), { params: Promise.resolve({ sessionId: String(sessionId) }) });
    return { response, result: await response.json() };
  };
  return { sessionId, rows, calls, server, request };
}

test("table double-click API starts waiting and cooking work with one configured countdown", async () => {
  const { rows, calls, request } = fixture();
  const { response, result } = await request("DOUBLE_CLICK_REQUEST");
  assert.equal(response.status, 200);
  assert.equal(result.success, true);
  assert.equal(result.command, "TABLE_DOUBLE_CLICK");
  assert.equal(result.completionCountdownSeconds, 3);
  assert.deepEqual(Array.from(result.taskIds), [41, 42, 43]);
  assert.deepEqual(rows.map(row => row.status), ["COOKING", "COOKING", "COOKING"]);
  const requests = rows.map(row => JSON.parse(row.previousState).completionRequest);
  assert.ok(requests.every(item => item.requestId === result.requestId && item.requestedAtMs === result.requestedAtMs));
  assert.ok(requests.every(item => item.expectedStatus === "COOKING" && item.expectedTaskIds.join(",") === "41,42,43"));
  assert.equal(requests[0].postCookTimerMinutes, 5);
  assert.equal(requests[1].postCookTimerMinutes, null);
  assert.equal(calls.commits, 1);
  assert.equal(calls.updates.length, 2);
  assert.equal(calls.updates.some(call => call.sql.includes("SET status='DONE'")), false);
});

test("a repeated table double-click request cannot replace or duplicate the pending request", async () => {
  const { rows, calls, request } = fixture();
  const first = await request("DOUBLE_CLICK_REQUEST");
  const second = await request("DOUBLE_CLICK_REQUEST");
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 409);
  assert.equal(rows.every(row => JSON.parse(row.previousState).completionRequest.requestId === first.result.requestId), true);
  assert.equal(calls.updates.length, 3);
  assert.equal(calls.rollbacks, 1);
});

test("double-click cancellation restores each task's exact pre-command state and metadata", async () => {
  const { rows, calls, server, request } = fixture();
  const original = rows.map(row => ({
    status: row.status, cookingGroupId: row.cookingGroupId, cookingStartedAtMs: row.cookingStartedAtMs,
    cookingCompletedAtMs: row.cookingCompletedAtMs, changedAtMs: row.changedAtMs,
    previousState: row.previousState, postCookTimerMinutes: row.postCookTimerMinutes,
    postCookTimerStartedAtMs: row.postCookTimerStartedAtMs,
  }));
  const { result: started } = await request("DOUBLE_CLICK_REQUEST");
  const canceled = await server.cancelKdsTableCompletion(9, started.requestId, started.requestedAtMs);
  assert.equal(canceled.cancelled, true);
  assert.equal(canceled.restoredOriginalStates, true);
  for (const [index, row] of rows.entries()) {
    for (const [key, value] of Object.entries(original[index])) assert.equal(row[key], value, key + " task " + row.taskId);
  }
  assert.equal(calls.commits, 2);
  assert.equal(calls.rollbacks, 0);
});

test("double-click completion commits after its deadline and cannot be undone afterward", async () => {
  const solo = [{ taskId: 51, itemId: 601, kind: "SOLO", status: "WAITING", changedAtMs: 500,
    cookingGroupId: null, cookingStartedAtMs: null, cookingCompletedAtMs: null, postCookTimerMinutes: null,
    postCookTimerStartedAtMs: null, previousState: null, timerEligible: 1, kdsKind: "SOLO" }];
  const { rows, server, request, calls } = fixture(solo);
  const { result: started } = await request("DOUBLE_CLICK_REQUEST");
  assert.equal(JSON.parse(rows[0].previousState).completionRequest.postCookTimerMinutes, null);
  let previous = JSON.parse(rows[0].previousState);
  previous.completionRequest.requestedAtMs = Date.now() - 4000;
  previous.completionRequest.expectedChangedAtMs = rows[0].changedAtMs;
  rows[0].previousState = JSON.stringify(previous);
  const finalized = await server.finalizeKdsTableCompletion(9, started.requestId, previous.completionRequest.requestedAtMs);
  assert.equal(finalized.outcome, "COMPLETED");
  assert.equal(rows[0].status, "DONE");
  const canceled = await server.cancelKdsTableCompletion(9, started.requestId, previous.completionRequest.requestedAtMs);
  assert.equal(canceled.outcome, "ALREADY_COMPLETED");
  assert.equal(rows[0].status, "DONE");
  assert.equal(calls.updates.filter(call => call.sql.includes("SET status='DONE'")).length, 1);
  assert.equal(calls.updates.filter(call => call.sql.includes("SET status=?,cooking_group_id")).length, 0);
});

test("stale task snapshots are rejected without partial state updates", async () => {
  const { rows, calls, request } = fixture();
  const stale = rows.map(row => ({ taskId: row.taskId, status: "WAITING", changedAtMs: row.changedAtMs }));
  const { response, result } = await request("DOUBLE_CLICK_REQUEST", stale);
  assert.equal(response.status, 409);
  assert.equal(result.success, false);
  assert.deepEqual(rows.map(row => row.status), ["WAITING", "COOKING", "WAITING"]);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.rollbacks, 1);
});
