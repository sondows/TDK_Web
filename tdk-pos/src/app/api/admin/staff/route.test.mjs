import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);

function loadRoute(rows) {
  const source = readFileSync(resolve(import.meta.dirname, "route.ts"), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const staff = Object.fromEntries([
    "staffId", "staffCode", "name", "role", "isActive", "employeePinHash",
  ].map(column => [column, column]));
  let selectedColumns;
  const query = {
    from: () => query,
    where: () => query,
    orderBy: async () => rows,
  };
  const db = { select: columns => { selectedColumns = columns; return query; } };
  const loaded = { exports: {} };
  runInNewContext(code, {
    module: loaded,
    exports: loaded.exports,
    Response,
    require: name => name === "drizzle-orm" ? { asc: value => value, ne: (...values) => values }
      : name === "@/db" ? { db }
        : name === "@/db/schema" ? { staff }
          : name === "@/lib/admin-auth" ? { requireOwnerSecurityAccess: async () => null }
            : nativeRequire(name),
  });
  return { get: loaded.exports.GET, selectedColumns: () => selectedColumns };
}

test("POS staff list uses only the shared PIN enrollment state", async () => {
  const { get, selectedColumns } = loadRoute([{
    staffId: 7, staffCode: "007", name: "Test Employee", role: "STAFF", isActive: 1, hasPin: null,
  }]);
  const response = await get();
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(selectedColumns()), ["staffId", "staffCode", "name", "role", "isActive", "hasPin"]);
  const result = await response.json();
  assert.equal(result.staff[0].hasPin, false);
  assert.equal("legacyPosPin" in result.staff[0], false);
});
