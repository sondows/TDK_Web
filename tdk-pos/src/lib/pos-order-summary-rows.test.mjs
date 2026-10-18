import assert from "node:assert/strict";
import test from "node:test";
import { buildOrderSummaryRows } from "./pos-order-summary-rows.ts";

test("summary keeps different options separate without changing amounts", () => {
  const base = { parentOrderItemId: null, menuId: 7, itemType: "NORMAL", itemName: "찌개", unitPrice: "10000.00" };
  const rows = buildOrderSummaryRows([
    { ...base, orderId: 1, orderItemId: 11, qty: 2, effectiveQty: 2, options: [{ modifierOptionId: 1, optionName: "순한맛", qty: 2, unitPrice: "0.00" }] },
    { ...base, orderId: 2, orderItemId: 12, qty: 1, effectiveQty: 1, options: [{ modifierOptionId: 1, optionName: "순한맛", qty: 1, unitPrice: "0.00" }] },
    { ...base, orderId: 3, orderItemId: 13, qty: 1, effectiveQty: 1, options: [{ modifierOptionId: 2, optionName: "매운맛", qty: 1, unitPrice: "0.00" }] },
  ]);

  assert.deepEqual(rows.map(row => [row.optionLabel, row.qty, row.total]), [
    ["순한맛", 3, 30000],
    ["매운맛", 1, 10000],
  ]);
});
