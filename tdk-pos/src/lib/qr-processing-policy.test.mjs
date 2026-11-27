import assert from "node:assert/strict";
import test from "node:test";
import { canBindAcceptedQrOrderSession, canHideRejectedQrOrder, canProcessQrOrder, qrOrderBlockReason, shouldBlockQrCodeChange, shouldBlockQrTokenCancellation } from "./qr-processing-policy.ts";

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

test("accepted QR order can bind only its own active, unexpired customer session", () => {
  const candidate = { orderQrSessionId: 41, customerQrSessionId: 41, candidateTableId: 4, targetTableId: 4,
    customerStatus: "ACTIVE", customerExpired: false };
  assert.equal(canBindAcceptedQrOrderSession(candidate), true);
  assert.equal(canBindAcceptedQrOrderSession({ ...candidate, orderQrSessionId: 42 }), false);
  assert.equal(canBindAcceptedQrOrderSession({ ...candidate, customerExpired: true }), false);
  assert.equal(canBindAcceptedQrOrderSession({ ...candidate, candidateTableId: 5 }), false);
  assert.equal(canBindAcceptedQrOrderSession({ ...candidate, customerStatus: "CLOSED" }), false);
});

test("orders remain blocked with an explicit reason instead of being implicitly rejected", () => {
  const base = { customerStatus: "ACTIVE", customerExpired: false, customerSessionId: null,
    tableSessionOpen: false, tableIdMatches: true, currentQrValid: true };
  assert.equal(qrOrderBlockReason(base), null);
  assert.equal(qrOrderBlockReason({ ...base, customerExpired: true }), "EXPIRED");
  assert.equal(qrOrderBlockReason({ ...base, customerStatus: "CLOSED" }), "SESSION_CLOSED");
  assert.equal(qrOrderBlockReason({ ...base, customerSessionId: 12, tableSessionOpen: false }), "SESSION_CLOSED");
  assert.equal(qrOrderBlockReason({ ...base, currentQrValid: false }), "QR_INVALID");
  assert.equal(qrOrderBlockReason({ ...base, tableIdMatches: false }), "TABLE_MISMATCH");
});

test("QR reassignment is blocked while a related order is pending", () => {
  assert.equal(shouldBlockQrCodeChange(0), false);
  assert.equal(shouldBlockQrCodeChange(1), true);
  assert.equal(shouldBlockQrCodeChange(4), true);
});

test("only rejected QR orders may be hidden from the staff order history", () => {
  assert.equal(canHideRejectedQrOrder("REJECTED"), true);
  for (const status of ["PENDING", "ACCEPTED", "CANCELLED"]) {
    assert.equal(canHideRejectedQrOrder(status), false);
  }
});
