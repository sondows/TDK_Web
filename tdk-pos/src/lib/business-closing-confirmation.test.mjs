import assert from "node:assert/strict";
import test from "node:test";
import { confirmedClosing, validClosing } from "./business-closing-confirmation.ts";

const saved = { businessDate: "2026-10-24", totalSales: 365000, saleCount: 12 };

test("a saved closing can be recovered after the POST response is lost", async () => {
  let requested = "";
  const request = async url => {
    requested = url;
    return { ok: true, json: async () => ({ success: true, closing: saved }) };
  };
  assert.deepEqual(await confirmedClosing("same-request-key", request), saved);
  assert.match(requested, /requestKey=same-request-key$/);
});

test("missing, malformed, and unreachable confirmations never claim success", async () => {
  assert.equal(await confirmedClosing("key", async () => ({ ok: true, json: async () => ({ success: true, closing: null }) })), null);
  assert.equal(await confirmedClosing("key", async () => ({ ok: true, json: async () => ({ success: true, closing: { ...saved, saleCount: "12" } }) })), null);
  assert.equal(await confirmedClosing("key", async () => { throw new Error("network error"); }), null);
  assert.equal(validClosing(saved), true);
});
