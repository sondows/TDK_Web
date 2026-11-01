import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(resolve(import.meta.dirname, "master-recovery-client.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const loaded = { exports: {} };
runInNewContext(compiled, { module: loaded, exports: loaded.exports, JSON });
const check = loaded.exports.checkMasterRecoveryId;
const actionLabel = loaded.exports.masterRecoveryActionLabel;

test("recovery ID check sends the normalized ID and bearer grant to the status API", async () => {
  let captured;
  const result = await check("  Sondows  ", "grant", async (url, options) => {
    captured = { url, options };
    return { ok: true, status: 200,
      json: async () => ({ available: true, loginId: "sondows", passwordConfigured: false }) };
  });
  assert.equal(captured.url, "/api/program-trust/master-recovery/status");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.cache, "no-store");
  assert.deepEqual(JSON.parse(captured.options.body), { loginId: "sondows", token: "grant" });
  assert.equal(result.confirmed, true);
  assert.equal(result.passwordConfigured, false);
});

test("a grant for another ID and an unavailable grant cannot confirm recovery", async () => {
  const wrongId = await check("sondows", "grant", async () => ({ ok: true, status: 200,
    json: async () => ({ available: true, loginId: "someoneelse" }) }));
  assert.equal(wrongId.confirmed, false);
  const unavailable = await check("sondows", "grant", async () => ({ ok: true, status: 200,
    json: async () => ({ available: false }) }));
  assert.equal(unavailable.confirmed, false);
  const limited = await check("sondows", "grant", async () => ({ ok: false, status: 429,
    json: async () => ({ available: false }) }));
  assert.equal(limited.confirmed, false);
  assert.equal(limited.rateLimited, true);
});

test("the recovery action reflects the confirmed server password state", async () => {
  assert.equal(actionLabel(false), "마스터 비밀번호 등록");
  assert.equal(actionLabel(true), "마스터 비밀번호 재설정");
  const configured = await check("sondows", "grant", async () => ({ ok: true, status: 200,
    json: async () => ({ available: true, loginId: "sondows", passwordConfigured: true }) }));
  assert.equal(configured.confirmed, true);
  assert.equal(actionLabel(configured.passwordConfigured), "마스터 비밀번호 재설정");
});
