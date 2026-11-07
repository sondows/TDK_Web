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

test("duplicate add-on finalize is delegated to the owning pot and is idempotent", async () => {
  const requestedAtMs = 1_800_000_000_000;
  const snapshots = new Map([
    [31, { status: "DONE", previousState: JSON.stringify({ completedTaskRequest: { ownerTaskId: 31, requestedAtMs } }) }],
    [32, { status: "COOKING", previousState: JSON.stringify({ completionRequest: { ownerTaskId: 31, requestedAtMs } }) }],
  ]);
  const queriedIds = [];
  let openedConnections = 0;
  const pool = {
    async query(_sql, [taskId]) {
      queriedIds.push(taskId);
      return [[snapshots.get(taskId)].filter(Boolean)];
    },
    async getConnection() { openedConnections++; throw new Error("completed duplicate must not start a second transaction"); },
  };
  const server = loadProductionModule("kds-server.ts", {
    "server-only": {}, "@/db": { pool },
    "@/lib/kds-model": model, "@/lib/kds-party-grouping": grouping,
  });

  assert.equal(await server.finalizeKdsTaskCompletion(32, requestedAtMs), true);
  assert.deepEqual(queriedIds, [32, 31]);
  assert.equal(openedConnections, 0);
});
