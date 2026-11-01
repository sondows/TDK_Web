import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const source = readFileSync(resolve(import.meta.dirname, "../app/api/admin-center/trust/initialize/route.ts"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
let authorized = false;
const state = { completedAt: null, staffRows: 0, ownerRows: 0, settingRows: 0, tokenRows: 0, audits: 0 };
const names = Object.fromEntries(["adminSecurityOwners", "adminSecuritySettings", "auditLogs",
  "programTrustTokens", "securityBootstrapState", "staff"].map(name => [name, { name }]));
const tx = {
  select() { let table; return {
    from(value) { table = value; return this; }, where() { return this; },
    limit() { return this; }, for() { return this; },
    then(resolve) {
      const result = table === names.securityBootstrapState ? [{ completedAt: state.completedAt }] :
        table === names.staff ? state.staffRows ? [{ staffId: 1 }] : [] :
          table === names.adminSecurityOwners ? state.ownerRows ? [{ staffId: 1 }] : [] :
            table === names.adminSecuritySettings ? state.settingRows ? [{ id: 1 }] : [] : [];
      return Promise.resolve(result).then(resolve);
    },
  }; },
  insert(table) { return { values: async () => {
    if (table === names.staff) { state.staffRows += 1; return [{ insertId: 1 }]; }
    if (table === names.adminSecurityOwners) state.ownerRows += 1;
    if (table === names.adminSecuritySettings) state.settingRows += 1;
    if (table === names.programTrustTokens) { state.tokenRows += 1; return [{ insertId: 1 }]; }
    if (table === names.auditLogs) state.audits += 1;
    return [{ insertId: 1 }];
  } }; },
  update(table) { return { set(values) { return { where: async () => {
    if (table === names.securityBootstrapState) state.completedAt = values.completedAt;
  } }; } }; },
};
const db = { select: (...args) => tx.select(...args), transaction: callback => callback(tx) };
const loaded = { exports: {} };
const cookies = [];
const NextResponse = { json(body, options = {}) {
  return { status: options.status ?? 200, body, cookies: { set: (...args) => cookies.push(args) } };
} };
runInNewContext(code, {
  module: loaded, exports: loaded.exports, Request, Response, Buffer, Date, URL, console,
  process: { env: {} },
  require: name => name === "node:crypto" ? nativeRequire(name) :
    name === "drizzle-orm" ? { and: () => ({}), eq: () => ({}), isNull: () => ({}), ne: () => ({}) } :
      name === "next/server" ? { NextResponse } :
        name === "@/db" ? { db } :
          name === "@/db/schema" ? names :
            name === "@/lib/auth" ? { hashProgramPassword: async () => "hashed-password",
              isValidProgramPassword: value => value.length >= 10 } :
              name === "@/lib/admin-auth-limit" ? { isAdminAuthAttemptAllowed: async () => true,
                recordAdminAuthFailure: async () => true, clearAdminAuthFailures: async () => {} } :
                name === "@/lib/nas-owner-setup" ? {
                  isNasOwnerSetupRequest: () => authorized,
                  isNasOwnerSetupWrite: () => authorized } :
                  name === "@/lib/kds-network-server" ? { getKdsRateLimitIp: async () => null } :
                    name === "@/lib/program-trust-client-label" ? { programTrustClientLabel: () => "Test browser" } :
                      name === "@/lib/program-trust" ? { isSecureTrustRequest: () => true,
                        newProgramTrustToken: () => "test-token", hashProgramTrustToken: () => "token-hash",
                        tokenCookieName: () => "tdk_adm_trust_1", trustCookieOptions: {} } :
                        name === "@/lib/staff-management-server" ? { newInternalStaffCode: () => "AUTO-TEST",
                          hasHosStaffPermissionColumn: async () => true } : nativeRequire(name),
});
const makeRequest = () => new Request("http://localhost:3000/api/admin-center/trust/initialize", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ loginId: "firstowner", password: "Strong#12345",
    confirmPassword: "Strong#12345" }),
});

test("NAS local setup and one-way latch allow exactly one first owner", async () => {
  assert.equal((await loaded.exports.GET(makeRequest())).body.available, false);
  const wrong = await loaded.exports.POST(makeRequest());
  assert.equal(wrong.status, 403);
  assert.equal(state.staffRows, 0);
  authorized = true;
  assert.equal((await loaded.exports.GET(makeRequest())).body.available, true);
  const first = await loaded.exports.POST(makeRequest());
  assert.equal(first.status, 200);
  assert.equal(first.body.success, true);
  assert.equal(state.staffRows, 1);
  assert.equal(state.ownerRows, 1);
  assert.equal(state.tokenRows, 0);
  assert.ok(state.completedAt instanceof Date);
  assert.equal((await loaded.exports.GET(makeRequest())).body.available, false);
  assert.equal(cookies.length, 0);
  const repeated = await loaded.exports.POST(makeRequest());
  assert.equal(repeated.status, 409);
  assert.equal(state.staffRows, 1);
});
