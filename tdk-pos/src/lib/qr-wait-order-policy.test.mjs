import test from "node:test";
import assert from "node:assert/strict";
import {
  canAssignQrWaitOrder,
  canCancelQrWaitOrder,
  canEditQrWaitOrder,
  needsQrWaitPriceAcknowledgement,
  qrWaitOrderIsExpired,
} from "./qr-wait-order-policy.ts";

test("only pending customer wait orders can be assigned or edited", () => {
  assert.equal(canAssignQrWaitOrder("PENDING"), true);
  assert.equal(canAssignQrWaitOrder("ASSIGNED"), false);
  assert.equal(canEditQrWaitOrder("PENDING"), true);
  assert.equal(canEditQrWaitOrder("ASSIGNED"), false);
  assert.equal(canEditQrWaitOrder("CONFIRMED"), false);
});

test("pending and assigned wait orders can be cancelled but accepted orders cannot", () => {
  assert.equal(canCancelQrWaitOrder("PENDING"), true);
  assert.equal(canCancelQrWaitOrder("ASSIGNED"), true);
  assert.equal(canCancelQrWaitOrder("CONFIRMED"), false);
  assert.equal(canCancelQrWaitOrder("CANCELLED"), false);
});

test("changed prices require acknowledgement for the current server total", () => {
  assert.equal(needsQrWaitPriceAcknowledgement("10000.00", "10000.00"), false);
  assert.equal(needsQrWaitPriceAcknowledgement("10000.00", "11000.00"), true);
  assert.equal(needsQrWaitPriceAcknowledgement("10000.00", "11000.00", "10000.00"), true);
  assert.equal(needsQrWaitPriceAcknowledgement("10000.00", "11000.00", "11000.00"), false);
});

test("wait order expires at the expiry instant and after it", () => {
  const expiry = new Date("2026-11-10T12:00:00Z");
  assert.equal(qrWaitOrderIsExpired(expiry, new Date("2026-11-10T11:59:59Z")), false);
  assert.equal(qrWaitOrderIsExpired(expiry, expiry), true);
  assert.equal(qrWaitOrderIsExpired(expiry, new Date("2026-11-10T12:00:01Z")), true);
});
