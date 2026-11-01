import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const source = readFileSync(resolve(import.meta.dirname, "master-password.ts"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const staff = { staffId: "staff_id", securityPasswordHash: "security_password_hash",
  isActive: "is_active", terminatedAt: "terminated_at" };
let row = null;
let verificationCalls = 0;
let selects = 0;
let whereConditions = [];
const db = {
  select() {
    selects += 1;
    return { from(table) { assert.equal(table, staff); return this; },
      where(condition) { whereConditions = condition; return this; },
      limit: async () => row ? [row] : [] };
  },
};
const loaded = { exports: {} };
runInNewContext(code, {
  module: loaded, exports: loaded.exports, Number,
  require: name => name === "server-only" ? {} :
    name === "drizzle-orm" ? {
      and: (...conditions) => conditions,
      eq: (field, value) => ({ field, value }),
      isNull: field => ({ field, value: null }),
    } : name === "@/db" ? { db } :
      name === "@/db/schema" ? { staff } :
        name === "@/lib/auth" ? { verifySecurityPassword: async (password, hash) => {
          verificationCalls += 1;
          return password === "test-only-input" && hash === "scrypt-test-hash";
        } } : nativeRequire(name),
});

test("accepts the configured master password for an active, non-terminated employee", async () => {
  row = { hash: "scrypt-test-hash" };
  assert.equal(await loaded.exports.verifyMasterPassword(41, "test-only-input"), true);
});

test("rejects a wrong password and an unconfigured password hash", async () => {
  row = { hash: "scrypt-test-hash" };
  assert.equal(await loaded.exports.verifyMasterPassword(41, "wrong-test-input"), false);
  const before = verificationCalls;
  row = { hash: null };
  assert.equal(await loaded.exports.verifyMasterPassword(41, "test-only-input"), false);
  assert.equal(verificationCalls, before);
});

test("rejects missing, inactive, and terminated employees through the database eligibility filter", async () => {
  row = null;
  const before = selects;
  assert.equal(await loaded.exports.verifyMasterPassword(41, "test-only-input"), false);
  assert.equal(selects, before + 1);
  assert.equal(whereConditions.some(condition => condition.field === staff.isActive && condition.value === 1), true);
  assert.equal(whereConditions.some(condition => condition.field === staff.terminatedAt && condition.value === null), true);
  row = { hash: "scrypt-test-hash" };
  const beforeInvalidId = selects;
  assert.equal(await loaded.exports.verifyMasterPassword(0, "test-only-input"), false);
  assert.equal(selects, beforeInvalidId);
});
