import assert from "node:assert/strict";
import test from "node:test";
import { aggregateSalesDisplayItems } from "./sales-item-aggregation.ts";

test("sale display aggregation uses only menu ID and actual unit price", () => {
  const rows = aggregateSalesDisplayItems([
    { checkoutItemId: 1, menuId: 7, itemName: "김치찌개", itemType: "NORMAL", unitPrice: 10000, qty: 29, amount: 290000 },
    { checkoutItemId: 2, menuId: 7, itemName: "김치찌개", itemType: "NORMAL", unitPrice: 10000, qty: 2, amount: 20000 },
    { checkoutItemId: 3, menuId: 7, itemName: "김치찌개", itemType: "SERVICE", unitPrice: 10000, qty: 1, amount: 10000 },
    { checkoutItemId: 4, menuId: 7, itemName: "김치찌개", itemType: "NORMAL", unitPrice: 11000, qty: 2, amount: 22000 },
    { checkoutItemId: 5, menuId: 8, itemName: "목살김치찌개", itemType: "NORMAL", unitPrice: 10000, qty: 1, amount: 10000 },
  ]);

  assert.deepEqual(rows.map(({ menuId, unitPrice, qty, amount }) => [menuId, unitPrice, qty, amount]), [
    [7, 10000, 32, 320000],
    [7, 11000, 2, 22000],
    [8, 10000, 1, 10000],
  ]);
  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 352000);
});

test("free items with the same menu ID and zero selling price aggregate", () => {
  const rows = aggregateSalesDisplayItems([
    { menuId: 99, itemName: "공기밥", itemType: "COMPONENT", unitPrice: 0, qty: 4, amount: 0 },
    { menuId: 99, itemName: "공기밥", itemType: "COMPONENT", unitPrice: 0, qty: 29, amount: 0 },
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].qty, rows[0].amount], [33, 0]);
});
