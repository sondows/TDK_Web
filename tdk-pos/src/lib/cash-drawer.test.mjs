import assert from "node:assert/strict";
import test from "node:test";
import { openCashDrawer } from "./cash-drawer.ts";

test("cash drawer posts to the existing localhost API and accepts its success response", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  let requestedInit;
  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url);
    requestedInit = init;
    return Response.json({ ok: true });
  };
  try {
    await openCashDrawer();
    assert.equal(requestedUrl, "http://127.0.0.1:5168/cash-drawer/open");
    assert.equal(requestedInit.method, "POST");
    assert.equal(requestedInit.cache, "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cash drawer reports the Device Agent command rejection", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    await assert.rejects(openCashDrawer(), /HTTP 403.*Origin rejected/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cash drawer reports a non-JSON error response without parsing it as JSON", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Forbidden", { status: 403 });
  try {
    await assert.rejects(openCashDrawer(), /HTTP 403.*Forbidden/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cash drawer separates timeouts and connection failures", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new DOMException("Timed out", "TimeoutError"); };
    await assert.rejects(openCashDrawer(), /시간이 초과/);
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    await assert.rejects(openCashDrawer(), /Device Agent에 연결할 수 없습니다/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
