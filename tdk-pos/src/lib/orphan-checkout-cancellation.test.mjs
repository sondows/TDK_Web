import test from "node:test";
import assert from "node:assert/strict";
import { isOrphanedUnpaidCheckout } from "./orphan-checkout-cancellation-model.ts";

test("closes an open checkout after all linked items and payments are cancelled", () => {
  assert.equal(isOrphanedUnpaidCheckout({
    checkoutStatus: "OPEN",
    paidAmount: 0,
    completedAt: null,
    itemStatuses: ["CANCELLED", "CANCELLED"],
    paymentStatuses: ["CANCELLED", "CANCELLED"],
  }), true);
});

test("does not close a checkout with any live item or active payment", () => {
  assert.equal(isOrphanedUnpaidCheckout({
    checkoutStatus: "OPEN",
    paidAmount: 0,
    completedAt: null,
    itemStatuses: ["CANCELLED", "ORDERED"],
    paymentStatuses: ["CANCELLED"],
  }), false);
  assert.equal(isOrphanedUnpaidCheckout({
    checkoutStatus: "PARTIALLY_PAID",
    paidAmount: 0,
    completedAt: null,
    itemStatuses: ["CANCELLED"],
    paymentStatuses: ["APPROVED"],
  }), false);
  assert.equal(isOrphanedUnpaidCheckout({
    checkoutStatus: "OPEN",
    paidAmount: 0,
    completedAt: null,
    itemStatuses: ["CANCELLED"],
    paymentStatuses: ["PENDING"],
  }), false);
});

test("does not close paid, completed, or itemless checkouts", () => {
  assert.equal(isOrphanedUnpaidCheckout({ checkoutStatus: "PAID", paidAmount: 0, completedAt: null, itemStatuses: ["CANCELLED"], paymentStatuses: [] }), false);
  assert.equal(isOrphanedUnpaidCheckout({ checkoutStatus: "OPEN", paidAmount: 1, completedAt: null, itemStatuses: ["CANCELLED"], paymentStatuses: [] }), false);
  assert.equal(isOrphanedUnpaidCheckout({ checkoutStatus: "OPEN", paidAmount: 0, completedAt: "2026-10-20 10:00:00", itemStatuses: ["CANCELLED"], paymentStatuses: [] }), false);
  assert.equal(isOrphanedUnpaidCheckout({ checkoutStatus: "OPEN", paidAmount: 0, completedAt: null, itemStatuses: [], paymentStatuses: [] }), false);
});
