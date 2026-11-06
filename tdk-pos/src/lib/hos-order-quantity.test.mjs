import test from "node:test";
import assert from "node:assert/strict";
import { clampHosRemainingQuantity, getHosCancellationQuantity } from "./hos-order-quantity.ts";

test("HOS keeps the original quantity when no cancellation is requested", () => {
  assert.equal(clampHosRemainingQuantity(2, 2), 2);
  assert.equal(getHosCancellationQuantity(2, 2), 0);
});

test("HOS converts a reduced remaining quantity to a partial cancellation", () => {
  assert.equal(clampHosRemainingQuantity(2, 1), 1);
  assert.equal(getHosCancellationQuantity(2, 1), 1);
});

test("HOS converts zero remaining quantity to a full cancellation", () => {
  assert.equal(clampHosRemainingQuantity(2, 0), 0);
  assert.equal(getHosCancellationQuantity(2, 0), 2);
});

test("HOS quantity controls cannot exceed the current effective quantity", () => {
  assert.equal(clampHosRemainingQuantity(2, 3), 2);
  assert.equal(clampHosRemainingQuantity(2, -1), 0);
  assert.equal(getHosCancellationQuantity(2, 3), 0);
});
