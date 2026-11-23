import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonResponse } from "./api-response.ts";

test("non-JSON HTTP errors become safe user messages with structured diagnostics", async () => {
  await assert.rejects(
    parseJsonResponse(new Response("Forbidden", { status: 403 }), "/api/sales?token=secret", "Receipt data preparation"),
    error => {
      assert.equal(error.message, "해당 기능에 접근할 권한이 없습니다.");
      assert.equal(error.status, 403);
      assert.equal(error.requestPath, "/api/sales");
      assert.equal(error.stage, "Receipt data preparation");
      assert.equal(error.failureKind, "NON_JSON");
      assert.equal(error.method, "UNKNOWN");
      return true;
    },
  );
});

test("JSON HTTP errors retain their server message with endpoint and status", async () => {
  await assert.rejects(
    parseJsonResponse(Response.json({ success: false, message: "Printer origin rejected" }, { status: 403 }), "http://127.0.0.1:5168/api/printer/document", "Receipt print"),
    error => {
      assert.equal(error.message, "Printer origin rejected");
      assert.equal(error.status, 403);
      assert.equal(error.requestPath, "/api/printer/document");
      assert.equal(error.failureKind, "HTTP_ERROR");
      assert.equal(error.method, "UNKNOWN");
      return true;
    },
  );
});

test("malformed JSON with a JSON content type does not leak the response body", async () => {
  await assert.rejects(
    parseJsonResponse(new Response("secret diagnostic", { status: 502, headers: { "Content-Type": "application/json" } }), "/api/sales", "Receipt data preparation"),
    error => error.message === "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요." && error.failureKind === "NON_JSON",
  );
});

test("successful JSON responses are returned", async () => {
  assert.deepEqual(await parseJsonResponse(Response.json({ success: true }), "/api/sales", "Receipt data preparation"), { success: true });
});
