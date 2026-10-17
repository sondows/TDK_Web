import assert from "node:assert/strict";
import { test } from "node:test";
import { hasOutstandingTakeoutPayment } from "./takeout-cancellation-payment.ts";

const payment = (status, appliedAmount, paymentId = 1) => ({ paymentId, status, appliedAmount });

test("cancelled, failed, pending and zero value payment history does not block takeout cancellation", () => {
  assert.equal(hasOutstandingTakeoutPayment([payment("CANCELLED", "10000.00")], [], []), false);
  assert.equal(hasOutstandingTakeoutPayment([payment("FAILED", "10000.00")], [], []), false);
  assert.equal(hasOutstandingTakeoutPayment([payment("PENDING", "10000.00")], [], []), false);
  assert.equal(hasOutstandingTakeoutPayment([payment("APPROVED", "0.00")], [], []), false);
});

test("only the amount allocated to this session matters for a shared payment", () => {
  assert.equal(hasOutstandingTakeoutPayment([payment("APPROVED", "0.00")], [], []), false);
  assert.equal(hasOutstandingTakeoutPayment([payment("APPROVED", "10000.00")], [], []), true);
});

test("unallocated legacy checkout payments use applied amount rather than tendered amount", () => {
  assert.equal(hasOutstandingTakeoutPayment([], [payment("APPROVED", "0.00")], []), false);
  assert.equal(hasOutstandingTakeoutPayment([], [payment("APPROVED", "10000.00")], []), true);
});

test("outstanding customer ledger blocks cancellation even when payment was marked cancelled", () => {
  assert.equal(hasOutstandingTakeoutPayment([payment("CANCELLED", "10000.00")], [], [{ paymentId: 1, amount: "10000.00" }]), true);
  assert.equal(hasOutstandingTakeoutPayment([payment("APPROVED", "0.00")], [], [{ paymentId: 1, amount: "10000.00" }]), true);
  assert.equal(hasOutstandingTakeoutPayment([payment("CANCELLED", "10000.00")], [], [{ paymentId: 1, amount: "10000.00" }, { paymentId: 1, amount: "-10000.00" }]), false);
});
