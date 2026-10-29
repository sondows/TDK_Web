import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);

function createLimiter(initialRow = null) {
  let row = initialRow;
  const inProcess = new Map();
  const db = {
    select: () => ({ from: () => ({ where: condition => ({ limit: async () =>
      row && row.staffId === condition.value ? [{ attemptCount: row.attemptCount, windowStartedAt: row.windowStartedAt }] : [] }) }) }),
    insert: () => ({ values: value => ({ onDuplicateKeyUpdate: async () => {
      if (!row || row.staffId !== value.staffId || row.windowStartedAt.getTime() <= Date.now() - 15 * 60 * 1000) row = { ...value };
      else row = { ...row, attemptCount: row.attemptCount + 1, updatedAt: new Date() };
    } }) }),
    delete: () => ({ where: async condition => { if (row?.staffId === condition.value) row = null; } }),
  };
  const source = readFileSync(resolve(import.meta.dirname, "kds-login-limit.ts"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loadedModule = { exports: {} };
  runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, console, Date,
    require: name => name === "server-only" ? {}
      : name === "drizzle-orm" ? { eq: (column, value) => ({ column, value }), sql: () => ({}) }
        : name === "@/db" ? { db }
          : name === "@/db/schema" ? { kdsLoginAttempts: { staffId: "staff_id", attemptCount: "attempt_count", windowStartedAt: "window_started_at" } }
            : name === "@/lib/admin-login-limit" ? {
              reserveAdminLoginAttempt: key => {
                const next = (inProcess.get(key) ?? 0) + 1;
                inProcess.set(key, next);
                return next <= 5;
              },
              isAdminLoginAttemptAllowed: key => (inProcess.get(key) ?? 0) < 5,
              clearAdminLoginAttempts: key => inProcess.delete(key),
            }
              : nativeRequire(name),
  }, { filename: "kds-login-limit.ts" });
  return { ...loadedModule.exports, get row() { return row; } };
}

test("only five bad PINs are counted, then the employee is locked before another PIN check", async () => {
  const limiter = createLimiter();
  for (let i = 0; i < 5; i++) {
    assert.equal(await limiter.isKdsLoginAttemptAllowed(7, "sondows"), true);
    assert.equal(await limiter.recordKdsLoginFailure(7, "sondows"), true);
  }
  assert.equal(limiter.row.attemptCount, 5);
  assert.equal(await limiter.isKdsLoginAttemptAllowed(7, "sondows"), false);
});

test("an expired 15-minute window permits a new failure sequence", async () => {
  const limiter = createLimiter({
    staffId: 7, attemptCount: 5, windowStartedAt: new Date(Date.now() - 16 * 60 * 1000),
  });
  assert.equal(await limiter.isKdsLoginAttemptAllowed(7, "sondows"), true);
  assert.equal(await limiter.recordKdsLoginFailure(7, "sondows"), true);
  assert.equal(limiter.row.attemptCount, 1);
});

test("device-enrollment attempts do not consume the employee PIN login counter", async () => {
  const limiter = createLimiter();
  for (let i = 0; i < 5; i++) assert.equal(limiter.reserveKdsEnrollmentAttempt(7, "sondows"), true);
  assert.equal(limiter.row, null);
  assert.equal(await limiter.isKdsLoginAttemptAllowed(7, "sondows"), true);
});
