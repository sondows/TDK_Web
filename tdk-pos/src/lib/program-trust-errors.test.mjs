import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyProgramTrustFailure } from "./program-trust-errors.ts";

test("classifies MySQL connection exhaustion", () => {
  assert.deepEqual(classifyProgramTrustFailure({ code: "ER_CON_COUNT_ERROR" }), {
    category: "connection_limit", code: "ER_CON_COUNT_ERROR",
  });
  assert.equal(classifyProgramTrustFailure({ cause: { code: "ER_TOO_MANY_USER_CONNECTIONS" } }).category, "connection_limit");
});

test("classifies database connection failures", () => {
  assert.equal(classifyProgramTrustFailure({ code: "ECONNREFUSED" }).category, "connection_failure");
  assert.equal(classifyProgramTrustFailure({ cause: { code: "PROTOCOL_CONNECTION_LOST" } }).category, "connection_failure");
});

test("classifies missing tables and columns as schema errors", () => {
  assert.equal(classifyProgramTrustFailure({ code: "ER_NO_SUCH_TABLE" }).category, "schema_error");
  assert.equal(classifyProgramTrustFailure({ code: "ER_BAD_FIELD_ERROR" }).category, "schema_error");
});

test("keeps other errors generic and excludes error messages", () => {
  const classified = classifyProgramTrustFailure({ code: "ER_PARSE_ERROR", message: "password=secret; token=abc" });
  assert.deepEqual(classified, { category: "internal_error", code: "ER_PARSE_ERROR" });
  assert.equal(JSON.stringify(classified).includes("secret"), false);
});
