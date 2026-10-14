import assert from "node:assert/strict";
import test from "node:test";
import { canEditDisplayedOrderSession } from "../src/lib/party-order-access.ts";

test("current table and current party peer may edit their original component", () => {
  assert.equal(canEditDisplayedOrderSession(7, null, 7, null), true);
  assert.equal(canEditDisplayedOrderSession(7, 5, 6, 5), true);
});

test("unrelated sessions and sessions with no active party are denied", () => {
  assert.equal(canEditDisplayedOrderSession(7, null, 6, null), false);
  assert.equal(canEditDisplayedOrderSession(7, 5, 6, 8), false);
  assert.equal(canEditDisplayedOrderSession(7, 5, 6, null), false);
});
