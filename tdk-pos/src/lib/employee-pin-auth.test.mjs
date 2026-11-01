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
const pins = { isValidEmployeePin: value => /^\d{6}$/.test(value) };
runInNewContext(js, {
  module: loaded, exports: loaded.exports, process,
  require: name => name === "server-only" ? {} : name === "crypto" ? nativeRequire("node:crypto")
    : name === "next/headers" ? { cookies: async () => ({ get: () => undefined }) }
      : name === "drizzle-orm" ? { and: () => ({}), eq: () => ({}), gt: () => ({}) }
        : name === "@/db" ? { db: {} } : name === "@/db/schema" ? { staff: {}, staffSessions: {} }
          : name === "@/lib/program-trust" ? { getCurrentProgramTrust: async () => null }
          : name === "@/lib/pin" ? pins : nativeRequire(name),
  console, Buffer, Date, Promise, Uint8Array,
});

test("shared employee PIN preserves leading zeroes and verifies the scrypt hash", async () => {
  const hash = await loaded.exports.hashEmployeePin("000042");
  assert.equal(await loaded.exports.verifyEmployeePin("000042", hash), true);
  assert.equal(await loaded.exports.verifyEmployeePin("100042", hash), false);
  assert.equal(await loaded.exports.verifyEmployeePin("42", hash), false);
});

test("shared PIN verification rejects legacy four-digit hashes without a fallback", async () => {
  const salt = "0123456789abcdef0123456789abcdef";
  const legacyKey = nativeRequire("node:crypto").scryptSync("1234", salt, 64, {
    N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  });
  const legacyHash = `scrypt$16384$8$1$${salt}$${legacyKey.toString("hex")}`;
  assert.equal(await loaded.exports.verifyEmployeePin("1234", legacyHash), false);
  assert.equal(loaded.exports.verifyStaffPin, undefined);
  assert.equal(loaded.exports.verifyAdminStaffPin, undefined);
  assert.equal(loaded.exports.verifyPin, undefined);
  assert.equal(loaded.exports.verifyAdminPin, undefined);
});

test("staff program password requires letters, digits and symbols and is hashed independently of PIN", async () => {
  for (const invalid of ["Short1!", "aaaaaaaaaa!", "1234567890!", "Password1234"]) {
    assert.equal(loaded.exports.isValidProgramPassword(invalid), false);
  }
  const value = "Example123!";
  assert.equal(loaded.exports.isValidProgramPassword(value), true);
  const hash = await loaded.exports.hashProgramPassword(value);
  assert.equal(hash.startsWith("scrypt$"), true);
  assert.equal(await loaded.exports.verifySecurityPassword(value, hash), true);
  assert.equal(await loaded.exports.verifySecurityPassword("Example123?", hash), false);
});

test("device-registration password policy remains separate and configurable at eight characters", async () => {
  assert.equal(loaded.exports.isValidSecurityPassword("12345678", 8), true);
  assert.equal(loaded.exports.isValidSecurityPassword("1234567", 8), false);
});
