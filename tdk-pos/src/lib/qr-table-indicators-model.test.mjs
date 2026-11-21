import assert from "node:assert/strict";
import test from "node:test";
import { qrTableIndicatorState } from "./qr-table-indicators-model.ts";

test("no valid token leaves the table indicator empty", () => {
  assert.equal(qrTableIndicatorState({ hasActiveQrToken: false, hasPendingQrOrder: false }), "NONE");
});

test("an active token without a pending order shows the blue-token state", () => {
  assert.equal(qrTableIndicatorState({ hasActiveQrToken: true, hasPendingQrOrder: false }), "TOKEN");
});

test("a pending QR order stays red after token expiry", () => {
  assert.equal(qrTableIndicatorState({ hasActiveQrToken: true, hasPendingQrOrder: true }), "ORDER_HISTORY");
  assert.equal(qrTableIndicatorState({ hasActiveQrToken: false, hasPendingQrOrder: true }), "ORDER_HISTORY");
});

test("accepted or rejected QR order history stays red after processing", () => {
  assert.equal(qrTableIndicatorState({ hasActiveQrToken: true, hasPendingQrOrder: false, hasQrOrderHistory: true }), "ORDER_HISTORY");
  assert.equal(qrTableIndicatorState({ hasActiveQrToken: false, hasPendingQrOrder: false, hasQrOrderHistory: true }), "ORDER_HISTORY");
});

test("states stay isolated per table and reset independently", () => {
  const statuses = new Map([
    [1, { hasActiveQrToken: true, hasPendingQrOrder: false, hasQrOrderHistory: true }],
    [2, { hasActiveQrToken: true, hasPendingQrOrder: false }],
    [3, { hasActiveQrToken: false, hasPendingQrOrder: false }],
  ]);
  assert.deepEqual([...statuses].map(([, status]) => qrTableIndicatorState(status)), ["ORDER_HISTORY", "TOKEN", "NONE"]);
});
