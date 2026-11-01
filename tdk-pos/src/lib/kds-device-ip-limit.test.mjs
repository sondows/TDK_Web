import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const source = readFileSync(resolve(import.meta.dirname, "kds-device.ts"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const states = new Map();
let written;
let locked;
let insertedHash;
let selectedHash;
let clientIp = "127.0.0.1";
const table = { ipHash: "ip_hash", windowStartedAt: "window_started_at",
  attemptCount: "attempt_count", updatedAt: "updated_at" };
const db = {
  delete() { return { where: async () => undefined }; },
  async transaction(callback) { return callback(tx); },
};
const tx = {
  insert() { return { values: values => { insertedHash = values.ipHash; return { onDuplicateKeyUpdate: async () => {
    if (!states.has(insertedHash)) states.set(insertedHash, { attemptCount: 0, windowExpired: 0 });
  } }; } }; },
  select() { return { from() { return this; }, where(condition) { selectedHash = condition.value; return this; }, limit() { return this; },
    async for(mode) { locked = mode === "update"; const state = states.get(selectedHash); return state ? [state] : []; } }; },
  update() { return { set(values) { written = values; return { where: async condition => {
    const state = states.get(condition.value);
    states.set(condition.value, { ...state, attemptCount: values.attemptCount,
      windowExpired: values.windowStartedAt ? 0 : state.windowExpired });
  } }; } }; },
};
const loaded = { exports: {} };
runInNewContext(code, {
  module: loaded, exports: loaded.exports, Date, process: { env: { NODE_ENV: "development" } },
  require: name => name === "server-only" ? {} :
    name === "node:crypto" ? nativeRequire(name) :
      name === "drizzle-orm" ? { eq: (field, value) => ({ field, value }), sql: (strings, ...values) => ({
        strings, values, as: name => ({ strings, values, alias: name }),
      }) } :
        name === "@/db" ? { db } :
          name === "@/db/schema" ? { kdsAuthIpAttempts: table } :
            name === "@/lib/auth" ? { sessionCookieSecure: false } :
              name === "@/lib/host-access" ? { isExternalAdminHost: () => false } :
                name === "@/lib/kds-network-server" ? { getKdsRateLimitIp: async () => clientIp } : nativeRequire(name),
});

const hashFor = scope => nativeRequire("node:crypto").createHash("sha256")
  .update(`${scope}\0${clientIp}`).digest("hex");

test("an expired IP window resets to one before applying the 30-attempt limit", async () => {
  states.clear();
  states.set(hashFor("network"), { attemptCount: 0, windowExpired: 0 });
  states.set(hashFor("id-status"), { attemptCount: 31, windowExpired: 1 });
  written = undefined; locked = false;
  assert.equal(await loaded.exports.reserveKdsIpAttempt("id-status"), "allowed");
  assert.equal(locked, true, "the IP row must be locked while deciding the window");
  assert.equal(written.attemptCount, 1);
  assert.ok(written.windowStartedAt instanceof Date);
});

test("an active IP window increments and denies attempt 31 without resetting its start", async () => {
  states.clear();
  states.set(hashFor("network"), { attemptCount: 0, windowExpired: 0 });
  states.set(hashFor("pin-login"), { attemptCount: 29, windowExpired: 0 });
  written = undefined;
  assert.equal(await loaded.exports.reserveKdsIpAttempt("pin-login"), "allowed");
  assert.equal(written.attemptCount, 30);
  assert.equal("windowStartedAt" in written, false);

  states.set(hashFor("pin-login"), { attemptCount: 30, windowExpired: 0 });
  written = undefined;
  assert.equal(await loaded.exports.reserveKdsIpAttempt("pin-login"), "scope-limited");
  assert.equal(written.attemptCount, 31);
  assert.equal("windowStartedAt" in written, false);
});

test("ID status lookups and PIN authentication use distinct IP limiter buckets", async () => {
  states.clear();
  await loaded.exports.reserveKdsIpAttempt("id-status");
  const statusHash = insertedHash;
  await loaded.exports.reserveKdsIpAttempt("pin-login");
  assert.notEqual(insertedHash, statusHash);
});

test("the network-wide bucket combines authentication stages and stops request 31", async () => {
  states.clear();
  states.set(hashFor("network"), { attemptCount: 29, windowExpired: 0 });
  assert.equal(await loaded.exports.reserveKdsIpAttempt("id-status"), "allowed");
  assert.equal(states.get(hashFor("network")).attemptCount, 30);
  assert.equal(await loaded.exports.reserveKdsIpAttempt("pin-login"), "network-limited");
  assert.equal(states.has(hashFor("pin-login")), false, "a network denial must not consume a phase bucket");
});

test("an unidentified client IP is not grouped into a shared fallback bucket", async () => {
  states.clear();
  clientIp = null;
  assert.equal(await loaded.exports.reserveKdsIpAttempt("pin-login"), "ip-unavailable");
  assert.equal(states.size, 0);
  clientIp = "127.0.0.1";
});
