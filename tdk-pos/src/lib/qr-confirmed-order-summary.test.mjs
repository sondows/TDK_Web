import assert from "node:assert/strict";
import test from "node:test";
import { buildQrConfirmedOrderSummary } from "./qr-confirmed-order-summary.ts";
import { buildOrderSummaryRows } from "./pos-order-summary-rows.ts";

const parent = (orderId, orderItemId, qty, extra = {}) => ({
  orderId, orderItemId, parentOrderItemId: null, menuId: 7, itemType: "NORMAL", itemName: "김치찌개",
  unitPrice: "12000.00", totalAmount: `${qty * 12000}.00`, qty, effectiveQty: qty,
  options: [{ modifierOptionId: 3, optionName: "약간매운맛", qty, unitPrice: "0.00" }], ...extra,
});

test("groups accepted QR-converted and direct POS items with POS summary identity rules", () => {
  const summary = buildQrConfirmedOrderSummary({
    orders: [{ orderId: 1, status: "ACCEPTED" }, { orderId: 2, status: "ACCEPTED" }, { orderId: 3, status: "CANCELLED" }],
    items: [parent(1, 11, 2), parent(2, 21, 3), parent(3, 31, 20)],
    cancellations: [], discountAmount: 0, prepaidAmount: 0,
  }, buildOrderSummaryRows);
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0].qty, 5);
  assert.equal(summary.rows[0].total, 60000);
  assert.equal(summary.totalAmount, 60000);
});

test("excludes awaiting orders and applies partial and full item cancellations", () => {
  const summary = buildQrConfirmedOrderSummary({
    orders: [{ orderId: 1, status: "ACCEPTED" }, { orderId: 2, status: "PENDING" }],
    items: [parent(1, 11, 3), parent(2, 21, 5)],
    cancellations: [{ orderItemId: 11, cancelledQty: 1 }], discountAmount: 1000, prepaidAmount: 5000,
  }, buildOrderSummaryRows);
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0].qty, 2);
  assert.equal(summary.grossAmount, 24000);
  assert.equal(summary.totalAmount, 23000);
  assert.equal(summary.receivableAmount, 18000);
});

test("preserves different option or actual selling price as distinct summary rows", () => {
  const summary = buildQrConfirmedOrderSummary({
    orders: [{ orderId: 1, status: "ACCEPTED" }, { orderId: 2, status: "ACCEPTED" }, { orderId: 3, status: "ACCEPTED" }],
    items: [
      parent(1, 11, 1),
      parent(2, 21, 1, { options: [{ modifierOptionId: 4, optionName: "매운맛", qty: 1, unitPrice: "0.00" }] }),
      parent(3, 31, 1, { unitPrice: "12500.00", totalAmount: "12500.00" }),
    ],
    cancellations: [], discountAmount: 0, prepaidAmount: 0,
  }, buildOrderSummaryRows);
  assert.equal(summary.rows.length, 3);
});
