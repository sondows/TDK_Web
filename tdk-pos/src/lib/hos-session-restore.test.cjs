/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  module._compile(output, filename);
};

const { decideHosSessionRestore } = require("./hos-session-restore.ts");

test("a confirmed HOS session restores the server-rendered table screen", () => {
  assert.equal(decideHosSessionRestore(200, true), "AUTHENTICATED");
});

test("only an explicit unauthorized response shows the login flow", () => {
  assert.equal(decideHosSessionRestore(401, false), "LOGIN_REQUIRED");
});

test("server failures and malformed status responses keep login hidden and allow retry", () => {
  assert.equal(decideHosSessionRestore(500, undefined), "RETRY");
  assert.equal(decideHosSessionRestore(503, false), "RETRY");
  assert.equal(decideHosSessionRestore(200, false), "RETRY");
});
