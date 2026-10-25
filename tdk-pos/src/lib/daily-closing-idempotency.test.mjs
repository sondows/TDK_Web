import assert from "node:assert/strict";
import test from "node:test";
import { sameDailyClosingResult } from "./daily-closing-idempotency.ts";

const current = { businessDate: "2026-10-24", openingCashEnabled: true, openingCash: 489600,
  totalSales: 365000, saleCount: 12, discountAmount: 2000, discountCount: 1,
  cardAmount: 365000, cardCount: 12, cashAmount: 0, cashCount: 0, otherAmount: 0,
  otherCount: 0, customerPaymentAmount: 0, customerPaymentCount: 0, bankTransferAmount: 0,
  cancellationCount: 2, refundAmount: 0, dineCount: 12, dineAmount: 365000,
  takeoutCount: 0, takeoutAmount: 0, cashReceived: 0, cashReturned: 0,
  cashLedgerMovement: 0, otherCashChange: 0, expectedCash: 489600 };
const fund = { otherAmount: 489600, counts: { 100: 0, 500: 0, 1000: 0, 5000: 0, 10000: 0, 50000: 0 } };

test("retry with the same settlement returns the saved closing", () => {
  assert.equal(sameDailyClosingResult({ ...current, actualCash: 489600, actualCashFund: fund, revision: 1 }, current, 489600, fund), true);
});

test("new sales, cash amount, denominations, or date require a new result", () => {
  const prior = { ...current, actualCash: 489600, actualCashFund: fund };
  assert.equal(sameDailyClosingResult(prior, { ...current, saleCount: 13 }, 489600, fund), false);
  assert.equal(sameDailyClosingResult(prior, current, 489500, fund), false);
  assert.equal(sameDailyClosingResult(prior, current, 489600, { ...fund, counts: { ...fund.counts, 100: 1 } }), false);
  assert.equal(sameDailyClosingResult(prior, { ...current, businessDate: "2026-10-25" }, 489600, fund), false);
});
