import test from "node:test";
import assert from "node:assert/strict";
import { countHosTablesWithOrders, formatHosNavBadge } from "./hos-nav-counts.ts";

test("store badge counts ordered tables once and skips merged source tables", () => {
  assert.equal(countHosTablesWithOrders([
    { isMergedSource: false, hasConfirmedOrder: true },
    { isMergedSource: false, hasConfirmedOrder: true },
    { isMergedSource: true, hasConfirmedOrder: true },
    { isMergedSource: false, hasConfirmedOrder: false },
  ]), 2);
});

test("navigation badges hide zero, keep 1 to 99, and cap larger counts", () => {
  assert.equal(formatHosNavBadge(null), null);
  assert.equal(formatHosNavBadge(0), null);
  assert.equal(formatHosNavBadge(1), "1");
  assert.equal(formatHosNavBadge(99), "99");
  assert.equal(formatHosNavBadge(100), "99+");
});
