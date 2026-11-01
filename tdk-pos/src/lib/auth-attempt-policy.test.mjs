import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(resolve(import.meta.dirname, "auth-attempt-policy.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const loaded = { exports: {} };
runInNewContext(compiled, { module: loaded, exports: loaded.exports, require });
const { AUTH_FAILURE_LIMIT, AUTH_FAILURE_WINDOW_MS, authAttemptKey, canAttempt, nextFailedAttempt } = loaded.exports;

test("counter keys normalize employee IDs and separate authentication stage and IP", () => {
  assert.equal(authAttemptKey("pin", "account", " SONDOWS "), authAttemptKey("pin", "account", "sondows"));
  assert.notEqual(authAttemptKey("pin", "account", "sondows"), authAttemptKey("pin", "account", "jindows"));
  assert.notEqual(authAttemptKey("pin", "account", "sondows"), authAttemptKey("master-password", "account", "sondows"));
  assert.notEqual(authAttemptKey("pin", "account", "sondows"), authAttemptKey("pin", "ip", "192.0.2.1"));
});

test("the 30th credential failure is recorded and the 31st is blocked without incrementing", () => {
  const now = Date.now();
  let counter;
  for (let index = 1; index <= AUTH_FAILURE_LIMIT; index++) {
    const next = nextFailedAttempt(counter, now);
    assert.equal(next.allowed, true, `failure ${index} should be recorded`);
    assert.equal(next.attemptCount, index);
    counter = next;
  }
  assert.equal(canAttempt(counter, now), false);
  const blocked = nextFailedAttempt(counter, now);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.attemptCount, AUTH_FAILURE_LIMIT);
});

test("the fixed window expires at 15 minutes and starts again from one", () => {
  const now = Date.now();
  const expired = { attemptCount: AUTH_FAILURE_LIMIT, windowStartedAt: now - AUTH_FAILURE_WINDOW_MS };
  assert.equal(canAttempt(expired, now), true);
  const next = nextFailedAttempt(expired, now);
  assert.equal(next.allowed, true);
  assert.equal(next.attemptCount, 1);
  assert.equal(next.windowStartedAt.getTime(), now);
});
