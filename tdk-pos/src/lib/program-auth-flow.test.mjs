import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(resolve(import.meta.dirname, "program-auth-flow.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const loaded = { exports: {} };
runInNewContext(compiled, { module: loaded, exports: loaded.exports });
const next = loaded.exports.transitionAuthPhase;
const resolveAdm = loaded.exports.resolveAdmIdStatus;

test("a recovery grant requires an ID status check before password setup", () => {
  assert.equal(next("CHECKING", { type: "RECOVERY_GRANTED" }), "RECOVERY_ID");
  assert.equal(next("RECOVERY_ID", { type: "RECOVERY_ID_CONFIRMED" }), "SETUP_PASSWORD");
  assert.equal(next("LOGIN_PASSWORD", { type: "RECOVERY_ID_CONFIRMED" }), "LOGIN_PASSWORD");
  assert.equal(next("SETUP_PASSWORD", { type: "PASSWORD_REGISTERED" }), "LOGIN_PASSWORD");
  assert.equal(next("CHECKING", { type: "RECOVERY_FAILED" }), "ERROR");
});

test("password, PIN and authenticated states follow server results", () => {
  assert.equal(next("CHECKING", { type: "TRUST_CHECKED", trusted: false,
    pinSetupRequired: false, bootstrapAvailable: false }), "LOGIN_PASSWORD");
  assert.equal(next("LOGIN_PASSWORD", { type: "PASSWORD_VERIFIED", pinSetupRequired: false }), "LOGIN_PIN");
  assert.equal(next("LOGIN_PASSWORD", { type: "PASSWORD_VERIFIED", pinSetupRequired: true }), "SETUP_PIN");
  assert.equal(next("SETUP_PIN", { type: "PIN_AUTHENTICATED" }), "AUTHENTICATED");
  assert.equal(next("LOGIN_PIN", { type: "PIN_AUTHENTICATED" }), "AUTHENTICATED");
  assert.equal(next("CHECKING", { type: "TRUST_CHECKED", trusted: true,
    pinSetupRequired: false, bootstrapAvailable: false }), "LOGIN_PIN");
});

test("initial owner and temporary password change do not skip password login", () => {
  assert.equal(next("CHECKING", { type: "TRUST_CHECKED", trusted: false,
    pinSetupRequired: false, bootstrapAvailable: true }), "BOOTSTRAP_SETUP");
  assert.equal(next("BOOTSTRAP_SETUP", { type: "BOOTSTRAP_COMPLETED" }), "LOGIN_PASSWORD");
  assert.equal(next("LOGIN_PASSWORD", { type: "TEMPORARY_PASSWORD_REQUIRED" }), "CHANGE_TEMPORARY_PASSWORD");
  assert.equal(next("CHANGE_TEMPORARY_PASSWORD", { type: "TEMPORARY_PASSWORD_CHANGED" }), "LOGIN_PASSWORD");
});

test("ADM state response fields choose the proper login phase without assuming state exists", () => {
  const normalSetupResponse = { trusted: false, pinSetupRequired: false, bootstrapAvailable: false,
    setupHttpStatus: 200, resetPasswordRequired: false };
  assert.equal(resolveAdm(normalSetupResponse), "LOGIN_PASSWORD");
  assert.equal(resolveAdm({ ...normalSetupResponse, trusted: true }), "LOGIN_PIN");
  assert.equal(resolveAdm({ ...normalSetupResponse, trusted: true, pinSetupRequired: true }), "SETUP_PIN");
  assert.equal(resolveAdm({ ...normalSetupResponse, bootstrapAvailable: true }), "BOOTSTRAP_SETUP");
  assert.equal(resolveAdm({ ...normalSetupResponse, setupHttpStatus: 403 }), "LOGIN_PASSWORD");
  assert.equal(resolveAdm({ ...normalSetupResponse, resetPasswordRequired: true }), "REGISTER_PASSWORD");
  assert.equal(resolveAdm({ ...normalSetupResponse, resetPasswordRequired: undefined,
    state: "MASTER_PASSWORD_REQUIRED", available: true }), "REGISTER_PASSWORD");
  assert.equal(resolveAdm({ ...normalSetupResponse, state: "REGISTRATION_NOT_ALLOWED" }),
    "REGISTRATION_NOT_ALLOWED");
  assert.equal(resolveAdm({ ...normalSetupResponse, state: "ACCOUNT_UNAVAILABLE" }), "ACCOUNT_UNAVAILABLE");
  assert.equal(resolveAdm({ ...normalSetupResponse, resetPasswordRequired: undefined }), "STATUS_UNAVAILABLE");
});
