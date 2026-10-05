import assert from "node:assert/strict";
import test from "node:test";

import { calculatePendingSales } from "./pending-sales-calculation.ts";

const empty = () => ({ sessions: [], merges: [], items: [], cancellations: [], discounts: [], checkoutLinks: [], payments: [] });
const item = (orderItemId, sessionId, amount) => ({ orderItemId, sessionId, qty: 1, unitPrice: String(amount), status: "ORDERED" });

test("no open bill is zero", () => {
  assert.deepEqual(calculatePendingSales(empty()), { amount: 0, count: 0 });
});

test("three open table transactions total 65,000 despite additional orders", () => {
  const input = empty();
  input.sessions = [1, 2, 3].map(sessionId => ({ sessionId, groupId: null }));
  input.items = [item(11, 1, 10000), item(12, 1, 10000), item(21, 2, 15000), item(31, 3, 30000)];
  assert.deepEqual(calculatePendingSales(input), { amount: 65000, count: 3 });
  assert.deepEqual({ amount: 660000 + calculatePendingSales(input).amount, count: 18 + calculatePendingSales(input).count }, { amount: 725000, count: 21 });
});

test("completed payment removes the bill from pending", () => {
  const input = empty();
  input.sessions = [{ sessionId: 1, groupId: null }, { sessionId: 2, groupId: null }];
  input.items = [item(11, 1, 20000), item(21, 2, 45000)];
  input.checkoutLinks = [{ checkoutId: 9, orderItemId: 11, status: "PAID" }];
  input.payments = [{ checkoutId: 9, appliedAmount: "20000" }];
  assert.deepEqual(calculatePendingSales(input), { amount: 45000, count: 1 });
});

test("cancelled sessions, items and quantities contribute nothing", () => {
  const input = empty();
  input.sessions = [{ sessionId: 1, groupId: null }]; // A cancelled session is excluded by the database query.
  input.items = [item(11, 1, 10000), { ...item(12, 1, 20000), status: "CANCELLED" }, item(21, 2, 30000)];
  input.cancellations = [{ orderItemId: 11, cancelledQty: 1 }];
  assert.deepEqual(calculatePendingSales(input), { amount: 0, count: 0 });
});

test("grouped and merged sessions count as one bill with discounts and partial payment", () => {
  const input = empty();
  input.sessions = [{ sessionId: 1, groupId: 7 }, { sessionId: 2, groupId: 7 }, { sessionId: 3, groupId: null }];
  input.merges = [{ sourceSessionId: 3, destinationSessionId: 1 }];
  input.items = [item(11, 1, 10000), item(21, 2, 20000), item(31, 3, 30000)];
  input.discounts = [{ sessionId: 2, discountAmount: "5000" }];
  input.checkoutLinks = [{ checkoutId: 9, orderItemId: 11, status: "PARTIALLY_PAID" }];
  input.payments = [{ checkoutId: 9, appliedAmount: "10000" }];
  assert.deepEqual(calculatePendingSales(input), { amount: 45000, count: 1 });
});
