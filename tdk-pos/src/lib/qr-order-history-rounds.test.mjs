import assert from "node:assert/strict";
import test from "node:test";
import { qrOrderRoundNumber, sortQrOrdersNewestFirst, totalQrOrderAmount } from "./qr-order-history-model.ts";

test("QR orders are shown newest first and retain original round numbers", () => {
  const ordered = sortQrOrdersNewestFirst([
    { qrOrderId: 1, orderedAt: "2026-11-18T17:35:00" },
    { qrOrderId: 2, orderedAt: "2026-11-18T17:50:00" },
  ]);
  assert.deepEqual(ordered.map(order => order.qrOrderId), [2, 1]);
  assert.deepEqual(ordered.map((_, index) => qrOrderRoundNumber(index, ordered.length)), [2, 1]);
});

test("QR history amount includes pending and accepted rounds, not rejected or cancelled rounds", () => {
  assert.equal(totalQrOrderAmount([
    { status: "PENDING", totalAmount: "3000" },
    { status: "ACCEPTED", totalAmount: "39000" },
    { status: "REJECTED", totalAmount: "99999" },
    { status: "CANCELLED", totalAmount: "5000" },
  ]), 42000);
});
