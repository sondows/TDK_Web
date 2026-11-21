import assert from "node:assert/strict";
import test from "node:test";
import { canAdoptQrOrderSession, canHideRejectedQrOrder, canProcessQrOrder, shouldBlockQrTokenCancellation } from "./qr-processing-policy.ts";

test("only pending QR orders can be approved or rejected", () => {
  assert.equal(canProcessQrOrder("PENDING"), true);
  for (const status of ["ACCEPTED", "REJECTED", "CANCELLED", "CLOSED"]) {
    assert.equal(canProcessQrOrder(status), false);
  }
});

test("token cancellation is blocked while any unprocessed QR order remains", () => {
  assert.equal(shouldBlockQrTokenCancellation(0), false);
  assert.equal(shouldBlockQrTokenCancellation(1), true);
  assert.equal(shouldBlockQrTokenCancellation(3), true);
});

test("pending unbound QR orders for one empty table can join the first accepted table session", () => {
  const candidate = { candidateTableId: 4, targetTableId: 4, candidateSessionId: null,
    qrSessionStatus: "ACTIVE", hasPendingOrder: true, hasOpenTableSession: false };
  assert.equal(canAdoptQrOrderSession(candidate), true);
  assert.equal(canAdoptQrOrderSession({ ...candidate, hasPendingOrder: false }), false);
  assert.equal(canAdoptQrOrderSession({ ...candidate, candidateTableId: 5 }), false);
  assert.equal(canAdoptQrOrderSession({ ...candidate, candidateSessionId: 91 }), false);
  assert.equal(canAdoptQrOrderSession({ ...candidate, qrSessionStatus: "CLOSED" }), false);
  assert.equal(canAdoptQrOrderSession({ ...candidate, hasOpenTableSession: true }), false);
});

test("only rejected QR orders may be hidden from the staff order history", () => {
  assert.equal(canHideRejectedQrOrder("REJECTED"), true);
  for (const status of ["PENDING", "ACCEPTED", "CANCELLED"]) {
    assert.equal(canHideRejectedQrOrder(status), false);
  }
});
