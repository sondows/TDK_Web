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

const { shouldRequireCancellationPin } = require("./cancellation-auth.ts");

test("full HOS cancellation does not require an additional PIN", () => {
  assert.equal(shouldRequireCancellationPin(true, "HOS"), false);
});

test("partial cancellation does not require an additional PIN", () => {
  assert.equal(shouldRequireCancellationPin(false, "HOS"), false);
  assert.equal(shouldRequireCancellationPin(false, "POS"), false);
});

test("full POS cancellation keeps its PIN requirement", () => {
  assert.equal(shouldRequireCancellationPin(true, "POS"), true);
  assert.equal(shouldRequireCancellationPin(true), true);
});
