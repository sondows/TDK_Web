import assert from "node:assert/strict";
import test from "node:test";

import { allocatePaymentAcrossSessions } from "./table-payment-allocation.ts";
import { calculateTableFinancials } from "./table-session-financials.ts";

const dues = new Map([[101, 20000], [103, 20000]]);
const scopes = [{ tableId: 1, sessionIds: [101] }, { tableId: 3, sessionIds: [103] }];

test("a partial party checkout payment reduces only the table where it was applied", () => {
  const firstPayment = allocatePaymentAcrossSessions({
    baseSessionId: 101,
    appliedAmount: 10000,
    balanceBySessionId: dues,
    paidBySessionId: new Map(),
  });
  assert.deepEqual(firstPayment, [{ sessionId: 101, amount: 10000 }]);

  const financials = calculateTableFinancials({
    tableScopes: scopes,
    grossBySessionId: dues,
    discountBySessionId: new Map(),
    prepaidBySessionId: new Map(firstPayment.map(row => [row.sessionId, row.amount])),
  });
  assert.equal(financials.get(1).remaining, 10000);
  assert.equal(financials.get(3).remaining, 20000);
});

test("payments applied separately to each party table remain independent after reload or party separation", () => {
  const firstPayment = [{ sessionId: 101, amount: 10000 }];
  const secondPayment = allocatePaymentAcrossSessions({
    baseSessionId: 103,
    appliedAmount: 5000,
    balanceBySessionId: dues,
    paidBySessionId: new Map([[101, 10000]]),
  });
  assert.deepEqual(secondPayment, [{ sessionId: 103, amount: 5000 }]);

  const persistedAllocations = [...firstPayment, ...secondPayment];
  const financials = calculateTableFinancials({
    tableScopes: scopes,
    grossBySessionId: dues,
    discountBySessionId: new Map(),
    prepaidBySessionId: new Map(persistedAllocations.map(row => [row.sessionId, row.amount])),
  });
  assert.deepEqual(financials.get(1), { gross: 20000, discount: 0, prepaid: 10000, total: 20000, remaining: 10000 });
  assert.deepEqual(financials.get(3), { gross: 20000, discount: 0, prepaid: 5000, total: 20000, remaining: 15000 });
});

test("a discount on one party session does not reduce the companion table", () => {
  const financials = calculateTableFinancials({
    tableScopes: scopes,
    grossBySessionId: dues,
    discountBySessionId: new Map([[101, 5000]]),
    prepaidBySessionId: new Map(),
  });
  assert.equal(financials.get(1).remaining, 15000);
  assert.equal(financials.get(3).remaining, 20000);
});

test("if one payment exceeds the selected table balance, only the excess spills to another session", () => {
  const allocations = allocatePaymentAcrossSessions({
    baseSessionId: 101,
    appliedAmount: 25000,
    balanceBySessionId: dues,
    paidBySessionId: new Map(),
  });
  assert.deepEqual(allocations, [{ sessionId: 101, amount: 20000 }, { sessionId: 103, amount: 5000 }]);
});
