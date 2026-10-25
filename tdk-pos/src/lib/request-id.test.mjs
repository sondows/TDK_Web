import assert from "node:assert/strict";
import test from "node:test";
import { createRequestId } from "./request-id.ts";

test("creates a valid request key when randomUUID is unavailable on an HTTP LAN origin", () => {
  const key = createRequestId({ getRandomValues: bytes => { bytes.fill(7); return bytes; } });
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("uses native randomUUID when available", () => {
  const expected = "12345678-1234-4234-8234-123456789abc";
  assert.equal(createRequestId({ randomUUID: () => expected }), expected);
});
