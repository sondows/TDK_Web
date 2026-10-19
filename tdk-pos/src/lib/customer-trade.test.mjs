import assert from "node:assert/strict";
import test from "node:test";
import { fullyReversedAdjacentLedgerPairs } from "./customer-trade.ts";

const original = (overrides = {}) => ({
  ledgerId: 1, entryType: "CUSTOMER_PAYMENT", amount: -60000,
  paymentId: 10, paymentStatus: "CANCELLED", reversesLedgerId: null, ...overrides,
});
const reversal = (overrides = {}) => ({
  ledgerId: 2, entryType: "CUSTOMER_PAYMENT_REVERSAL", amount: 60000,
  paymentId: 10, paymentStatus: "CANCELLED", reversesLedgerId: 1, ...overrides,
});

test("hides only an adjacent, fully offset payment and its explicit reversal", () => {
  assert.deepEqual(fullyReversedAdjacentLedgerPairs([original(), reversal()]),
    [{ originalId: 1, reversalId: 2 }]);
  assert.deepEqual(fullyReversedAdjacentLedgerPairs([
    original({ entryType: "CARD_OVERPAYMENT", amount: 5000 }),
    reversal({ entryType: "CARD_OVERPAYMENT_REVERSAL", amount: -5000 }),
  ]), [{ originalId: 1, reversalId: 2 }]);
});

test("partial, mismatched and unlinked reversals remain visible", () => {
  assert.deepEqual(fullyReversedAdjacentLedgerPairs([original(), reversal({ amount: 20000 })]), []);
  assert.deepEqual(fullyReversedAdjacentLedgerPairs([original(), reversal({ paymentId: 11 })]), []);
  assert.deepEqual(fullyReversedAdjacentLedgerPairs([original(), reversal({ reversesLedgerId: null })]), []);
  assert.deepEqual(fullyReversedAdjacentLedgerPairs([original({ paymentId: null }), reversal({ paymentId: null })]), []);
  assert.deepEqual(fullyReversedAdjacentLedgerPairs([original(), reversal({ paymentStatus: "APPROVED" })]), []);
});

test("an intervening real trade keeps the entire balance sequence visible", () => {
  const deposit = { ledgerId: 3, entryType: "DEPOSIT", amount: 10000, paymentId: null, paymentStatus: null, reversesLedgerId: null };
  assert.deepEqual(fullyReversedAdjacentLedgerPairs([original(), deposit, reversal()]), []);
  assert.deepEqual(fullyReversedAdjacentLedgerPairs([deposit, original(), reversal()]),
    [{ originalId: 1, reversalId: 2 }]);
});
