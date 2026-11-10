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

function loadServer(pool) {
  const source = readFileSync(resolve(import.meta.dirname, "kds-server.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loadedModule = { exports: {} };
  runInNewContext(compiled, {
    module: loadedModule, exports: loadedModule.exports, Date, console,
    require: name => name === "server-only" ? {} : name === "@/db" ? { pool }
      : name === "@/lib/kds-model" ? model : name === "@/lib/kds-party-grouping" ? grouping
        : nativeRequire(name),
  }, { filename: "kds-server.ts" });
  return loadedModule.exports;
}

function completionDb(startSource) {
  const changedAtMs = Date.now() - 500;
  const storedTask = {
    taskId: 45, status: "COOKING", cookingGroupId: null, cookingStartedAtMs: changedAtMs,
    cookingCompletedAtMs: null, changedAtMs,
    previousState: JSON.stringify({ status: "WAITING", cookingGroupId: null,
      cookingStartedAtMs: null, cookingCompletedAtMs: null, startSource }),
    memberItems: JSON.stringify([{ itemId: 73, kind: "SOLO" }]), kind: "SOLO",
  };
  let committed = false;
  const connection = {
    async beginTransaction() {}, async commit() { committed = true; }, async rollback() {}, release() {},
    async query(sql) {
      if (sql.includes("FROM kds_tasks WHERE task_id=? FOR UPDATE")) return [[storedTask]];
      if (sql.includes("FROM system_settings")) return [[]];
      if (sql.includes("FROM order_items oi")) return [[{
        itemId: 73, parentItemId: null, timerEligible: 0, kdsKind: "SOLO", kdsVisible: 1,
        itemStatus: "ACTIVE", remaining: 1, orderStatus: "CONFIRMED", sessionStatus: "OPEN",
      }]];
      throw new Error(`Unexpected KDS completion query: ${sql.slice(0, 80)}`);
    },
    async execute() { return [{ affectedRows: 1 }]; },
  };
  return { changedAtMs, get committed() { return committed; }, pool: { async getConnection() { return connection; } } };
}

test("server accepts the status-button completion after a menu-button start, including before start request UI settles", async () => {
  const db = completionDb("MENU");
  const server = loadServer(db.pool);
  const result = await server.requestKdsTaskCompletion(45,
    { status: "COOKING", changedAtMs: db.changedAtMs }, undefined, 5, "STATUS");
  assert.equal(db.committed, true);
  assert.equal(typeof result.requestedAtMs, "number");
  assert.equal(result.completionCountdownSeconds, 5);
});

test("server rejects same-button undo attempts, center-menu completion, and table starts during the undo window", async () => {
  for (const [startSource, completionInputButton] of [["MENU", "MENU"], ["STATUS", "MENU"], ["TABLE", "STATUS"], ["STATUS", "STATUS"], ["STATUS", undefined]]) {
    const db = completionDb(startSource);
    const server = loadServer(db.pool);
    await assert.rejects(
      server.requestKdsTaskCompletion(45, { status: "COOKING", changedAtMs: db.changedAtMs }, undefined, 5, completionInputButton),
      error => error.statusCode === 409 && error.message.includes("완료 요청을 시작할 수 없습니다"),
    );
    assert.equal(db.committed, false);
  }
});
