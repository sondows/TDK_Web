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

const { HOS_SESSION_COOKIE_MAX_AGE_SECONDS, isHosSessionCurrentBusinessDate } = require("./hos-session-policy.ts");

test("HOS session remains valid throughout its database business date", () => {
  assert.equal(isHosSessionCurrentBusinessDate("2026-11-08", "2026-11-08"), true);
});

test("HOS session expires when the database business date changes", () => {
  assert.equal(isHosSessionCurrentBusinessDate("2026-11-08", "2026-11-09"), false);
  assert.equal(isHosSessionCurrentBusinessDate("2026-12-31", "2027-01-01"), false);
});

test("invalid business-date values cannot validate an HOS session", () => {
  assert.equal(isHosSessionCurrentBusinessDate("", "2026-11-08"), false);
  assert.equal(isHosSessionCurrentBusinessDate("2026-11-08", ""), false);
});

test("HOS browser cookie can persist across app restarts for the day", () => {
  assert.ok(HOS_SESSION_COOKIE_MAX_AGE_SECONDS >= 24 * 60 * 60);
});
