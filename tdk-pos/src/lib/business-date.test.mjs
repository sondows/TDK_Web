import assert from "node:assert/strict";
import test from "node:test";
import { resolveBusinessDate } from "./business-date.ts";

test("business date changes exactly at cutoff", () => {
  assert.equal(resolveBusinessDate("2026-10-19 05:59:59", "06:00"), "2026-10-18");
  assert.equal(resolveBusinessDate("2026-10-19 06:00:00", "06:00"), "2026-10-19");
  assert.equal(resolveBusinessDate("2026-10-19 01:20:00", "06:00"), "2026-10-18");
  assert.equal(resolveBusinessDate("2026-10-19 11:00:00", "06:00"), "2026-10-19");
  assert.equal(resolveBusinessDate("2027-01-01 00:00:00", "06:00"), "2026-12-31");
});
