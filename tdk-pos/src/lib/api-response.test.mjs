import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonResponse } from "./api-response.ts";

test("non-JSON HTTP errors report stage, endpoint, status, and response body", async () => {
  await assert.rejects(
    parseJsonResponse(new Response("Forbidden", { status: 403 }), "/api/sales", "Receipt data preparation"),
    /Receipt data preparation: \/api\/sales returned HTTP 403.*body: Forbidden/,
  );
});

test("JSON HTTP errors retain their server message with endpoint and status", async () => {
  await assert.rejects(
    parseJsonResponse(Response.json({ success: false, message: "Printer origin rejected" }, { status: 403 }), "http://127.0.0.1:5168/api/printer/document", "Receipt print"),
    /Receipt print: http:\/\/127\.0\.0\.1:5168\/api\/printer\/document returned HTTP 403.*Printer origin rejected/,
  );
});

test("successful JSON responses are returned", async () => {
  assert.deepEqual(await parseJsonResponse(Response.json({ success: true }), "/api/sales", "Receipt data preparation"), { success: true });
});
