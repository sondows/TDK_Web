import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const source = readFileSync(resolve(import.meta.dirname, "program-trust.ts"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const staff = Object.fromEntries(["staffId", "posEnabled", "adminEnabled", "kdsEnabled", "hosEnabled", "isActive", "terminatedAt", "staffCode"].map(key => [key, key]));
const programTrustTokens = Object.fromEntries(["tokenId", "tokenHash", "program", "revokedAt", "enrolledByStaffId"].map(key => [key, key]));
const runtimeEnv = { NODE_ENV: "production" };
let cookie = null;
let record = null;
let extraCookies = [];
let extraRecords = [];
const db = {
  select() { return {
    from() { return this; }, innerJoin() { return this; },
    where(conditions) { this.conditions = conditions; return this; },
    orderBy() { return this; },
    async limit() {
      return [record, ...extraRecords].filter(Boolean).filter(candidate => this.conditions.every(condition =>
        condition.op === "isNull" ? candidate[condition.field] == null :
        condition.op === "in" ? condition.values.includes(candidate[condition.field]) :
        condition.op === "eq" ? candidate[condition.field] === condition.value :
          candidate[condition.field] !== condition.value)).map(candidate => ({
        tokenId: candidate.tokenId, enrolledByStaffId: candidate.enrolledByStaffId, tokenHash: candidate.tokenHash,
      }));
    },
  }; },
};
const loaded = { exports: {} };
runInNewContext(code, {
  module: loaded, exports: loaded.exports, process: { env: runtimeEnv }, Request, URL,
  require: name => name === "server-only" ? {}
    : name === "node:crypto" ? nativeRequire(name)
      : name === "next/headers" ? { cookies: async () => ({ getAll: () => [
        ...(cookie ? [{ name: "tdk_kds_trust_7", value: cookie }] : []), ...extraCookies,
      ] }) }
        : name === "drizzle-orm" ? {
          eq: (field, value) => ({ op: "eq", field, value }),
          ne: (field, value) => ({ op: "ne", field, value }),
          isNull: field => ({ op: "isNull", field }),
          inArray: (field, values) => ({ op: "in", field, values }),
          desc: field => ({ op: "desc", field }),
          and: (...conditions) => conditions,
          sql: () => ({}),
        } : name === "@/db" ? { db } : name === "@/db/schema" ? { staff, programTrustTokens } : nativeRequire(name),
});

test("one employee's revoked KDS token does not invalidate another employee's token on a shared browser", async () => {
  const auth = loaded.exports;
  cookie = auth.newProgramTrustToken();
  const secondToken = auth.newProgramTrustToken();
  record = { tokenId: 7, enrolledByStaffId: 2, tokenHash: auth.hashProgramTrustToken(cookie),
    program: "KDS", revokedAt: new Date(), terminatedAt: null, isActive: 0,
    kdsEnabled: 0, posEnabled: 1, adminEnabled: 1, staffCode: "002" };
  extraCookies = [{ name: "tdk_kds_trust_8", value: secondToken }];
  extraRecords = [{ tokenId: 8, enrolledByStaffId: 3, tokenHash: auth.hashProgramTrustToken(secondToken),
    program: "KDS", revokedAt: null, terminatedAt: null, isActive: 1,
    kdsEnabled: 1, posEnabled: 1, adminEnabled: 1, staffCode: "003" }];
  assert.equal((await auth.getCurrentProgramTrust("KDS", { tokenId: 8 }))?.tokenId, 8);
  assert.equal(await auth.getCurrentProgramTrust("KDS", { tokenId: 7 }), null);
  extraCookies = []; extraRecords = []; cookie = null; record = null;
});

test("program cookies are distinct and tokens are random, hashed and scoped", async () => {
  const auth = loaded.exports;
  assert.equal(new Set(Object.values(auth.programCookieName)).size, 4);
  assert.equal(auth.trustCookieOptions.httpOnly, true);
  assert.equal(auth.trustCookieOptions.secure, true);
  assert.equal(auth.trustCookieOptions.sameSite, "strict");
  assert.ok(auth.trustCookieOptions.maxAge >= 365 * 24 * 60 * 60);
  const token = auth.newProgramTrustToken();
  assert.notEqual(token, auth.newProgramTrustToken());
  assert.notEqual(auth.hashProgramTrustToken(token), token);
  assert.equal(auth.hashProgramTrustToken(token).length, 64);
  cookie = token;
  record = { tokenId: 7, enrolledByStaffId: 2, tokenHash: auth.hashProgramTrustToken(token),
    program: "KDS", revokedAt: null, terminatedAt: null, isActive: 1, kdsEnabled: 1, posEnabled: 1, adminEnabled: 1, staffCode: "002" };
  assert.equal((await auth.getCurrentProgramTrust("KDS"))?.tokenId, 7);
  assert.equal(await auth.getCurrentProgramTrust("POS"), null);
  record.revokedAt = new Date();
  assert.equal(await auth.getCurrentProgramTrust("KDS"), null);
  record.revokedAt = null;
  record.isActive = 0;
  assert.equal(await auth.getCurrentProgramTrust("KDS"), null);
  record.isActive = 1;
  record.kdsEnabled = 0;
  assert.equal(await auth.getCurrentProgramTrust("KDS"), null);
  cookie = null;
  assert.equal(await auth.getCurrentProgramTrust("KDS"), null);
});

test("production enrollment requires the ingress verified HTTPS marker", () => {
  const secure = loaded.exports.isSecureTrustRequest;
  assert.equal(secure(new Request("http://192.168.0.83:3000/api/auth/trust")), false);
  assert.equal(secure(new Request("https://tdkon.myasustor.com/api/auth/trust")), false);
  assert.equal(secure(new Request("https://tdkon.myasustor.com/api/auth/trust", {
    headers: { "x-tdk-verified-https": "1" },
  })), true);
});

test("local HTTP enrollment requires a socket-attested development request", () => {
  runtimeEnv.NODE_ENV = "development";
  try {
    const secure = loaded.exports.isSecureTrustRequest;
    const url = "http://0.0.0.0:3000/api/auth/trust";
    assert.equal(secure(new Request(url, { headers: { host: "localhost:3000" } })), false);
    assert.equal(secure(new Request(url, { headers: { host: "localhost:3000", "x-tdk-local-dev": "1" } })), true);
    assert.equal(secure(new Request(url, { headers: { host: "evil.example:3000", "x-tdk-local-dev": "1" } })), false);
  } finally { runtimeEnv.NODE_ENV = "production"; }
});
