import assert from "node:assert/strict";
import test from "node:test";
import { buildOrderSummaryRows, buildPartyOrderRows } from "./pos-order-summary-rows.ts";

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

test("party rows combine same menu and per-item options across separate orders", () => {
  const base = {
    parentOrderItemId: null,
    menuId: 7,
    itemType: "NORMAL",
    itemName: "흑돼지김치찌개",
    unitPrice: "10000.00",
    discountAmount: "0.00",
  };
  const partyRows = buildPartyOrderRows(
    [29, 2, 1].flatMap((qty, index) => {
      const orderItemId = index + 101;
      return [
        {
          ...base,
          orderId: index + 1,
          sessionId: index + 11,
          orderItemId,
          qty,
          effectiveQty: qty,
          options: [{ modifierOptionId: 3, optionName: "약간매운맛", qty, unitPrice: "0.00" }],
        },
        {
          ...base,
          orderId: index + 1,
          sessionId: index + 11,
          orderItemId: orderItemId + 1000,
          parentOrderItemId: orderItemId,
          menuId: 99,
          itemType: "COMPONENT",
          itemName: "공기밥",
          unitPrice: "0.00",
          qty,
          effectiveQty: qty,
          options: [],
        },
      ];
    }),
  );

  assert.equal(partyRows.length, 1);
  assert.equal(partyRows[0].qty, 32);
  assert.equal(partyRows[0].total, 320000);
  assert.equal(partyRows[0].components.length, 1);
  assert.equal(partyRows[0].components[0].qty, 32);
  assert.equal(partyRows.reduce((sum, row) => sum + row.total, 0), 320000);
});

test("party rows ignore options but keep different menu IDs and selling prices separate", () => {
  const base = {
    parentOrderItemId: null,
    menuId: 7,
    itemType: "NORMAL",
    itemName: "흑돼지김치찌개",
    discountAmount: "0.00",
    sessionId: 11,
  };
  const rows = buildPartyOrderRows(
    [
      { ...base, orderId: 1, orderItemId: 101, qty: 2, effectiveQty: 2, unitPrice: "10000.00", options: [{ modifierOptionId: 3, optionName: "약간매운맛", qty: 2, unitPrice: "0.00" }] },
      { ...base, orderId: 2, orderItemId: 102, qty: 1, effectiveQty: 1, unitPrice: "10000.00", options: [{ modifierOptionId: 4, optionName: "매운맛", qty: 1, unitPrice: "0.00" }] },
      { ...base, orderId: 3, orderItemId: 103, qty: 1, effectiveQty: 1, unitPrice: "12000.00", options: [{ modifierOptionId: 3, optionName: "약간매운맛", qty: 1, unitPrice: "0.00" }] },
      { ...base, orderId: 4, orderItemId: 104, menuId: 8, itemName: "목살김치찌개", qty: 1, effectiveQty: 1, unitPrice: "10000.00", options: [{ modifierOptionId: 3, optionName: "약간매운맛", qty: 1, unitPrice: "0.00" }] },
    ],
  );

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => [row.name, row.qty, row.total]), [
    ["흑돼지김치찌개", 3, 30000],
    ["흑돼지김치찌개", 1, 12000],
    ["목살김치찌개", 1, 10000],
  ]);
});

test("party aggregation prorates each stored order amount after partial cancellation", () => {
  const rows = buildPartyOrderRows([
    {
      orderId: 1,
      orderItemId: 201,
      parentOrderItemId: null,
      menuId: 7,
      itemType: "NORMAL",
      itemName: "흑돼지김치찌개",
      qty: 3,
      effectiveQty: 2,
      unitPrice: "10000.00",
      totalAmount: "30000.00",
      discountAmount: "0.00",
      sessionId: 11,
      options: [],
    },
    {
      orderId: 2,
      orderItemId: 202,
      parentOrderItemId: null,
      menuId: 7,
      itemType: "NORMAL",
      itemName: "흑돼지김치찌개",
      qty: 1,
      effectiveQty: 1,
      unitPrice: "10000.00",
      totalAmount: "9800.00",
      discountAmount: "0.00",
      sessionId: 12,
      options: [],
    },
  ]);

  assert.equal(rows[0].qty, 3);
  assert.equal(rows[0].total, 29800);
});
