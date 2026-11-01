import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const source = readFileSync(resolve(import.meta.dirname, "route.ts"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const staff = { staffId: "staff_id", securityPasswordHash: "security_password_hash" };
const adminSecurityOwners = { staffId: "owner_staff_id", passwordHash: "legacy_owner_hash" };
const staffSessions = { sessionTokenHash: "session_hash", sessionType: "session_type", status: "status",
  ownerReauthenticatedAt: "owner_reauthenticated_at" };
const auditLogs = {};
const programTrustTokens = { enrolledByStaffId: "trust_staff_id", revokedAt: "revoked_at" };
const masterPassword = `Master#${randomBytes(18).toString("hex")}`;
const legacyPassword = `Legacy#${randomBytes(18).toString("hex")}`;
let securityState = "NEEDS_REAUTH";
const tablesRead = [];
const updates = [];
const masterPasswordCalls = [];
const db = {
  select() { return { from(table) { this.table = table; tablesRead.push(table); return this; }, where() { return this; },
    limit: function() { const rows = this.table === adminSecurityOwners ? [{ staffId: 7 }] :
      [{ hash: "staff-master-hash", active: 1, adminEnabled: 1 }]; const result = Promise.resolve(rows);
      result.for = async () => rows; return result; } }; },
  update(table) { return { set(value) { updates.push({ table, value }); return { where: async () => [{ affectedRows: 1 }] }; } }; },
  insert() { return { values: async () => undefined }; },
  transaction: async callback => callback(db),
};
const cookies = { get: name => name === "tdk_admin_session" ? { value: "admin.session" } : undefined };
const loaded = { exports: {} };
runInNewContext(code, {
  module: loaded, exports: loaded.exports, Request, Response, Date, console,
  require: name => name === "server-only" ? {} :
    name === "drizzle-orm" ? { and: (...args) => args, eq: (field, value) => ({ field, value }),
      inArray: (field, value) => ({ field, value }), isNull: field => ({ field }) } :
      name === "next/headers" ? { cookies: async () => ({ get: cookies.get }) } :
        name === "@/db" ? { db } :
      name === "@/db/schema" ? { adminSecurityOwners, auditLogs, programTrustTokens, staff, staffSessions } :
            name === "@/lib/admin-auth" ? { ADMIN_SESSION_COOKIE_NAME: "tdk_admin_session",
              getCurrentAdminStaff: async () => ({ staffId: 7 }), getOwnerSecurityState: async () => securityState } :
              name === "@/lib/auth" ? { hashProgramPassword: async () => "new-master-hash",
                hashSessionToken: value => value, isValidProgramPassword: () => true } :
                name === "@/lib/master-password" ? { verifyMasterPassword: async (staffId, password) => {
                  masterPasswordCalls.push({ staffId, password });
                  return staffId === 7 && password === masterPassword;
                } } :
                name === "@/lib/kds-device" ? { isSameOriginRequest: () => true } :
                  name === "@/lib/kds-network-server" ? { getKdsRateLimitIp: async () => null } :
                    name === "@/lib/admin-auth-limit" ? { clearAdminAuthFailures: async () => {},
                      isAdminAuthAttemptAllowed: async () => true, recordAdminAuthFailure: async () => true } :
                      nativeRequire(name),
});

const request = body => new Request("https://tdkon.myasustor.com/api/admin-center/security/owner-password", {
  method: "POST", headers: { origin: "https://tdkon.myasustor.com", host: "tdkon.myasustor.com",
    "content-type": "application/json" }, body: JSON.stringify(body),
});

test("owner security verification uses the shared verifier for the session employee", async () => {
  masterPasswordCalls.length = 0;
  const response = await loaded.exports.POST(request({ action: "verify", password: masterPassword }));
  assert.equal(response.status, 200);
  assert.equal(masterPasswordCalls.length, 1);
  assert.equal(masterPasswordCalls[0].staffId, 7);
  assert.equal(tablesRead.includes(adminSecurityOwners), false);
  assert.equal(updates.some(update => update.table === staffSessions), true);
});

test("legacy owner password is not accepted as a fallback", async () => {
  masterPasswordCalls.length = 0;
  const response = await loaded.exports.POST(request({ action: "verify", password: legacyPassword }));
  assert.equal(response.status, 401);
  assert.deepEqual(masterPasswordCalls.map(call => call.staffId), [7]);
  assert.equal(tablesRead.includes(adminSecurityOwners), false);
});

test("legacy owner-password setup cannot create another credential", async () => {
  updates.length = 0;
  const response = await loaded.exports.POST(request({ action: "setup", password: legacyPassword,
    confirm: legacyPassword }));
  assert.equal(response.status, 409);
  assert.equal(updates.length, 0);
});

test("owner master-password change updates the shared hash and preserves PIN, trust tokens, and sessions", async () => {
  securityState = "AUTHORIZED";
  updates.length = 0;
  const nextPassword = `Next#${randomBytes(18).toString("hex")}`;
  const response = await loaded.exports.POST(request({ action: "change", oldPassword: masterPassword,
    newPassword: nextPassword, confirm: nextPassword }));
  assert.equal(response.status, 200);
  assert.equal(updates.some(update => update.table === staff && update.value.securityPasswordHash === "new-master-hash"), true);
  assert.equal(updates.some(update => update.table === programTrustTokens), false);
  assert.equal(updates.some(update => update.table === staffSessions && update.value.ownerReauthenticatedAt === null), true);
  assert.equal(updates.some(update => update.table === staffSessions && update.value.status === "LOGGED_OUT"), false);
  assert.equal(updates.some(update => update.table === adminSecurityOwners), false);
  securityState = "NEEDS_REAUTH";
});
