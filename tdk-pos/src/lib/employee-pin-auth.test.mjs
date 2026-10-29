import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const source = readFileSync(resolve(import.meta.dirname, "auth.ts"), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
const pins = { isValidEmployeePin: value => /^\d{6}$/.test(value), isValidPin: value => /^\d{4}$/.test(value) };
runInNewContext(js, {
  module: loaded, exports: loaded.exports, process,
  require: name => name === "server-only" ? {} : name === "crypto" ? nativeRequire("node:crypto")
    : name === "next/headers" ? { cookies: async () => ({ get: () => undefined }) }
      : name === "drizzle-orm" ? { and: () => ({}), eq: () => ({}), gt: () => ({}) }
        : name === "@/db" ? { db: {} } : name === "@/db/schema" ? { staff: {}, staffSessions: {} }
          : name === "@/lib/pin" ? pins : nativeRequire(name),
  console, Buffer, Date, Promise, Uint8Array,
});

test("shared employee PIN preserves leading zeroes and verifies the scrypt hash", async () => {
  const hash = await loaded.exports.hashEmployeePin("000042");
  assert.equal(await loaded.exports.verifyEmployeePin("000042", hash), true);
  assert.equal(await loaded.exports.verifyEmployeePin("100042", hash), false);
  assert.equal(await loaded.exports.verifyEmployeePin("42", hash), false);
});

test("common PIN takes precedence while unmigrated employees can use the legacy POS hash", async () => {
  const common = await loaded.exports.hashEmployeePin("012345");
  const legacy = await loaded.exports.hashPin("1234");
  assert.equal(await loaded.exports.verifyStaffPin("012345", common, legacy), true);
  assert.equal(await loaded.exports.verifyStaffPin("1234", common, legacy), false);
  assert.equal(await loaded.exports.verifyStaffPin("1234", null, legacy), true);
});

test("ADM uses the common employee PIN and only falls back to the legacy ADM hash before migration", async () => {
  const common = await loaded.exports.hashEmployeePin("006789");
  const legacyAdm = await loaded.exports.hashAdminPin("123456");
  assert.equal(await loaded.exports.verifyAdminStaffPin("006789", common, legacyAdm), true);
  assert.equal(await loaded.exports.verifyAdminStaffPin("123456", common, legacyAdm), false);
  assert.equal(await loaded.exports.verifyAdminStaffPin("123456", null, legacyAdm), true);
});

test("OWNER security password requires 10 characters and a special character", async () => {
  assert.equal(loaded.exports.isValidOwnerSecurityPassword("short!"), false);
  assert.equal(loaded.exports.isValidOwnerSecurityPassword("longpassword"), false);
  assert.equal(loaded.exports.isValidOwnerSecurityPassword("a-strong-owner-passphrase"), true);
  const hash = await loaded.exports.hashOwnerSecurityPassword("a-strong-owner-passphrase");
  assert.notEqual(hash, "a-strong-owner-passphrase");
  assert.equal(await loaded.exports.verifySecurityPassword("a-strong-owner-passphrase", hash), true);
  assert.equal(await loaded.exports.verifySecurityPassword("incorrect-owner-passphrase", hash), false);
});

test("device-registration password policy remains separate and configurable at eight characters", async () => {
  assert.equal(loaded.exports.isValidSecurityPassword("12345678", 8), true);
  assert.equal(loaded.exports.isValidSecurityPassword("1234567", 8), false);
});
