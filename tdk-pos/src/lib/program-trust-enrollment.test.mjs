import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const source = readFileSync(resolve(import.meta.dirname, "program-trust-routes.ts"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const staff = { staffId: "staff_id", securityPasswordHash: "security_password_hash",
  employeePinHash: "employee_pin_hash", securityPasswordChangeRequired: "security_password_change_required",
  adminLoginId: "admin_login_id", isActive: "is_active", adminEnabled: "admin_enabled", posEnabled: "pos_enabled",
  terminatedAt: "terminated_at", staffCode: "staff_code", kdsEnabled: "kds_enabled" };
const schema = { staff, programTrustTokens: { tokenId: "token_id" },
  auditLogs: { name: "audit_logs" }, staffSessions: { name: "staff_sessions" } };
const issuedCookies = [];
const candidate = { staffId: 7, hash: "stored-hash", passwordHash: "stored-hash", passwordChangeRequired: 0,
  pinHash: "already-set", loginId: "employee7", posEnabled: 1 };
let eligibilityCandidate = candidate;
Object.assign(candidate, { isActive: 1, adminEnabled: 1, terminatedAt: null, staffCode: "TEST-7" });
let currentTrust = null;
const tx = { insert: () => ({ values: async () => [{ insertId: 42 }] }) };
const db = {
  select() { return { from() { return this; }, where() { return this; },
    limit: async () => eligibilityCandidate ? [eligibilityCandidate] : [] }; },
  transaction: callback => callback(tx),
};
const NextResponse = { json(body, options = {}) {
  return { status: options.status ?? 200, body,
    cookies: { set: (...args) => issuedCookies.push(args) } };
} };
const loaded = { exports: {} };
runInNewContext(code, {
  module: loaded, exports: loaded.exports, Request, URL, Date, console,
  require: name => name === "server-only" ? {} :
    name === "drizzle-orm" ? { and: () => ({}), eq: () => ({}), isNull: () => ({}),
      ne: () => ({}), sql: () => ({}) } :
      name === "next/server" ? { NextResponse } :
        name === "next/headers" ? { cookies: async () => ({ getAll: () => [], get: () => ({ value: "opaque-test-cookie" }) }) } :
          name === "@/db" ? { db } :
            name === "@/db/schema" ? schema :
              name === "@/lib/auth" ? {} :
                name === "@/lib/master-password" ? { verifyMasterPassword: async (staffId, password) =>
                  staffId === candidate.staffId && password === "Valid#12345" } :
                name === "@/lib/admin-auth-limit" ? {
                  isAdminAuthAttemptAllowed: async () => true,
                  recordAdminAuthFailure: async () => true,
                  clearAdminAuthFailures: async () => {},
                  reserveAdminStatusAttempt: async () => true,
                } :
                  name === "@/lib/kds-device" ? { isHttpsSameOriginRequest: () => true,
                    reserveKdsIpAttempt: async () => "allowed" } :
                    name === "@/lib/kds-network-server" ? { getKdsRateLimitIp: async () => null } :
                      name === "@/lib/program-trust-client-label" ? { programTrustClientLabel: () => "Test browser" } :
                        name === "@/lib/program-trust-errors" ? { classifyProgramTrustFailure: () => ({ category: "internal_error", code: null }) } :
                        name === "@/lib/program-trust" ? {
                          isSecureTrustRequest: () => true,
                          programPermission: () => staff.kdsEnabled,
                          getCurrentProgramTrust: async () => currentTrust,
                          hashProgramTrustToken: () => "token-hash",
                          programCookieName: { POS: "tdk_pos_trust", KDS: "tdk_kds_trust" },
                          newProgramTrustToken: () => "random-test-token",
                          hashProgramTrustToken: () => "token-hash",
                          tokenCookieName: () => "tdk_kds_trust_42",
                          trustCookieOptions: { httpOnly: true, secure: true },
                        } : nativeRequire(name),
});

const request = password => new Request("https://tdkon.myasustor.com/api/kitchen/auth/trust", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ loginId: "employee7", password }),
});

test("first enrollment accepts ID and password without a network-dependent PIN", async () => {
  const wrong = await loaded.exports.enrollProgramTrust(request("Incorrect#12345"), "KDS");
  assert.equal(wrong.status, 401);
  assert.equal(issuedCookies.length, 0);
  const valid = await loaded.exports.enrollProgramTrust(request("Valid#12345"), "KDS");
  assert.equal(valid.status, 200);
  assert.equal(valid.body.pinSetupRequired, false);
  assert.equal(issuedCookies.length, 1);
  assert.equal(issuedCookies[0][0], "tdk_kds_trust_42");
});

test("only an explicitly reset account enters master-password registration instead of authentication", async () => {
  const issuedBefore = issuedCookies.length;
  candidate.passwordHash = null;
  candidate.passwordChangeRequired = 1;
  const result = await loaded.exports.enrollProgramTrust(request("Unused#12345"), "KDS");
  assert.equal(result.status, 200);
  assert.equal(result.body.passwordRegistrationRequired, true);
  assert.equal(issuedCookies.length, issuedBefore, "reset state must not issue a program trust cookie");
  candidate.passwordHash = "stored-hash";
  candidate.passwordChangeRequired = 0;
});

test("KDS ID status requires one active, KDS-enabled employee before exposing the next phase", async () => {
  const valid = await loaded.exports.trustStatus("KDS",
    new Request("https://tdkon.myasustor.com/api/kitchen/auth/trust?loginId=employee7"));
  assert.equal(valid.status, 200);
  assert.equal(valid.body.success, true);
  assert.equal(valid.body.trusted, false);
  assert.equal(valid.body.passwordRegistrationRequired, false);

  candidate.passwordHash = null;
  candidate.passwordChangeRequired = 1;
  const reset = await loaded.exports.trustStatus("KDS",
    new Request("https://tdkon.myasustor.com/api/kitchen/auth/trust?loginId=employee7"));
  assert.equal(reset.status, 200);
  assert.equal(reset.body.passwordRegistrationRequired, true,
    "only an explicitly reset account can see the master-password registration phase");
  candidate.passwordHash = "stored-hash";
  candidate.passwordChangeRequired = 0;

  eligibilityCandidate = null;
  const unavailable = await loaded.exports.trustStatus("KDS",
    new Request("https://tdkon.myasustor.com/api/kitchen/auth/trust?loginId=employee7"));
  assert.equal(unavailable.status, 403);
  assert.equal(unavailable.body.trusted, false);
  eligibilityCandidate = candidate;
});

test("POS ID status validates an active POS-enabled account and reports its next authentication state", async () => {
  candidate.passwordHash = "stored-hash";
  candidate.passwordChangeRequired = 0;
  candidate.posEnabled = 1;
  eligibilityCandidate = candidate;
  currentTrust = null;
  const requestForId = () => new Request("https://tdkon.myasustor.com/api/auth/trust?loginId=employee7");

  const masterLogin = await loaded.exports.trustStatus("POS", requestForId());
  assert.equal(masterLogin.status, 200);
  assert.equal(masterLogin.body.success, true);
  assert.equal(masterLogin.body.trusted, false);
  assert.equal(masterLogin.body.masterPasswordConfigured, true);
  assert.equal(masterLogin.body.passwordRegistrationRequired, false);

  candidate.passwordHash = null;
  candidate.passwordChangeRequired = 1;
  const reset = await loaded.exports.trustStatus("POS", requestForId());
  assert.equal(reset.status, 200);
  assert.equal(reset.body.masterPasswordConfigured, false);
  assert.equal(reset.body.passwordRegistrationRequired, true,
    "a NULL hash alone must not authorize registration; the explicit reset flag is required");

  candidate.passwordChangeRequired = 0;
  const unapproved = await loaded.exports.trustStatus("POS", requestForId());
  assert.equal(unapproved.status, 200);
  assert.equal(unapproved.body.passwordRegistrationRequired, false);

  candidate.passwordHash = "stored-hash";
  currentTrust = { tokenId: 42, enrolledByStaffId: 7, cookieName: "tdk_pos_trust_42" };
  const trusted = await loaded.exports.trustStatus("POS", requestForId());
  assert.equal(trusted.body.trusted, true);
  assert.equal(trusted.body.loginId, "employee7");
  assert.equal(trusted.body.pinSetupRequired, false);
  assert.equal(issuedCookies.at(-1)[0], "tdk_pos_trust_42");

  eligibilityCandidate = null;
  const unavailable = await loaded.exports.trustStatus("POS", requestForId());
  assert.equal(unavailable.status, 403);
  assert.equal(unavailable.body.trusted, false);
  eligibilityCandidate = candidate;
  currentTrust = null;
});

test("ADM ID status rejects ineligible accounts and accepts an eligible account without a trust token", async () => {
  const requestForAdm = () => new Request("https://tdkon.myasustor.com/api/admin-center/trust?loginId=employee7");
  eligibilityCandidate = candidate;
  currentTrust = null;
  const valid = await loaded.exports.trustStatus("ADM", requestForAdm());
  assert.equal(valid.status, 200);
  assert.equal(valid.body.success, true);
  assert.equal(valid.body.trusted, false);

  eligibilityCandidate = null;
  const invalid = await loaded.exports.trustStatus("ADM", requestForAdm());
  assert.equal(invalid.status, 403);
  assert.equal(invalid.body.success, false);
  assert.equal(invalid.body.trusted, false);
  eligibilityCandidate = candidate;
});
