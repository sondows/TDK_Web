import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCheckoutBreakdown, summarizeSalesFinancials } from "./sales-financial-summary.ts";

test("mixed payments count one discounted sale and allocated takeout revenue", () => {
  const checkouts = [{ id: 1, total: 30000, discount: 1000 }, { id: 2, total: 20000, discount: 0 }];
  const payments = [
    { paymentId: 10, checkoutId: 1, appliedAmount: 20000, methodType: "CARD", status: "APPROVED", cancelledAt: null },
    { paymentId: 11, checkoutId: 1, appliedAmount: 10000, methodType: "CASH", status: "APPROVED", cancelledAt: null },
    { paymentId: 12, checkoutId: 2, appliedAmount: 20000, methodType: "CARD", status: "APPROVED", cancelledAt: null },
  ];
  const allocations = [
    { paymentId: 10, checkoutId: 1, appliedAmount: 15000, sessionKind: "TAKEOUT" },
    { paymentId: 10, checkoutId: 1, appliedAmount: 5000, sessionKind: "DINE_IN" },
    { paymentId: 11, checkoutId: 1, appliedAmount: 10000, sessionKind: "TAKEOUT" },
    { paymentId: 12, checkoutId: 2, appliedAmount: 20000, sessionKind: "DINE_IN" },
  ];
  const sales = summarizeSalesFinancials(checkouts, payments, "2026-10-19", "2026-10-19");
  const breakdown = summarizeCheckoutBreakdown(checkouts, payments, new Set([1]), allocations);
  assert.equal(sales.netSales, 50000);
  assert.equal(sales.transactionCount, 2);
  assert.equal(sales.discountAmount, 1000);
  assert.deepEqual(breakdown, { discountCount: 1, takeoutAmount: 25000, takeoutCount: 1 });
});

test("cancelled payments and unsold discounted checkouts are excluded from detail counts", () => {
  const checkouts = [{ id: 1, discount: 1000 }, { id: 2, discount: 2000 }];
  const payments = [
    { paymentId: 10, checkoutId: 1, appliedAmount: 20000, status: "CANCELLED" },
    { paymentId: 11, checkoutId: 2, appliedAmount: 15000, status: "APPROVED" },
  ];
  const allocations = [
    { paymentId: 10, checkoutId: 1, appliedAmount: 20000, sessionKind: "TAKEOUT" },
    { paymentId: 11, checkoutId: 2, appliedAmount: 15000, sessionKind: "DINE_IN" },
  ];
  assert.deepEqual(summarizeCheckoutBreakdown(checkouts, payments, new Set([1]), allocations),
    { discountCount: 1, takeoutAmount: 0, takeoutCount: 0 });
});

test("missing allocation on a takeout sale yields unknown rather than fabricated revenue", () => {
  const result = summarizeCheckoutBreakdown(
    [{ id: 1, discount: 0 }],
    [{ paymentId: 10, checkoutId: 1, appliedAmount: 20000, status: "APPROVED" }],
    new Set([1]),
    [],
  );
  assert.deepEqual(result, { discountCount: 0, takeoutAmount: null, takeoutCount: null });
});
