import assert from "node:assert/strict";
import test from "node:test";
import { expectedBusinessCash } from "./business-cash.ts";
import { summarizeSalesFinancials } from "./sales-financial-summary.ts";

test("mixed payments count once as a sale; cash register only follows physical cash", () => {
  const sales = summarizeSalesFinancials([{ id: 1, total: 30000, discount: 0 }], [
    { checkoutId: 1, appliedAmount: 20000, methodType: "CARD", status: "APPROVED", cancelledAt: null },
    { checkoutId: 1, appliedAmount: 10000, methodType: "CASH", status: "APPROVED", cancelledAt: null },
  ], "2026-10-18", "2026-10-18");
  assert.equal(sales.netSales, 30000);
  assert.equal(sales.transactionCount, 1);
  assert.equal(sales.cardAmount, 20000);
  assert.equal(sales.cashAmount, 10000);
  assert.equal(expectedBusinessCash(100000, 10000, 0, 0, 0), 110000);
});

test("cash refund, customer cash refund and explicit other-payment change reduce expected cash", () => {
  assert.equal(expectedBusinessCash(100000, 30000, 20000, -5000, 3000), 102000);
});
