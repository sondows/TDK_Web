import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as model from "./kds-model.ts";

const nativeRequire = createRequire(import.meta.url);

function loadProductionModule(path, mocks) {
  const source = readFileSync(resolve(import.meta.dirname, path), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  runInNewContext(compiled, {
    module, exports: module.exports, Date, console, setTimeout, Response, Request,
    require: name => name in mocks ? mocks[name] : nativeRequire(name),
  }, { filename: path });
  return module.exports;
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

test("an uncancelled countdown reaches the real FINALIZE path once", async () => {
  const { finalize, row, calls } = cancellationFixture({ requestAgeMs: 5000 });
  const response = await finalize();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).completed, 1);
  assert.equal(row.status, "DONE");
  assert.equal(calls.updates.filter(call => call.sql.includes("SET status='DONE'")).length, 1);
});
