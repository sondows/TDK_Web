import assert from "node:assert/strict";
import test from "node:test";
import { buildOrderSummaryRows, buildPartyOrderRows } from "./pos-order-summary-rows.ts";

test("POS summaries show independent add-on quantities and keep different addon quantities separate", () => {
  const base = { parentOrderItemId: null, menuId: 7, itemType: "NORMAL", itemName: "Stew", unitPrice: "10000.00" };
  const rows = buildOrderSummaryRows([
    { ...base, orderId: 1, orderItemId: 1, qty: 2, effectiveQty: 2,
      options: [{ modifierOptionId: 301, optionName: "Ham", qty: 1, unitPrice: "3000.00", independentQty: true }] },
    { ...base, orderId: 2, orderItemId: 2, qty: 2, effectiveQty: 2,
      options: [{ modifierOptionId: 301, optionName: "Ham", qty: 3, unitPrice: "3000.00", independentQty: true }] },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.optionLabel), ["Ham", "Ham ×3"]);
});

test("partial base-menu cancellation preserves independently selected add-on amount", () => {
  const [row] = buildOrderSummaryRows([{
    orderId: 1, orderItemId: 1, parentOrderItemId: null, menuId: 7, itemType: "NORMAL",
    itemName: "Stew", qty: 2, effectiveQty: 1, unitPrice: "10000.00", totalAmount: "26000.00",
    options: [{ modifierOptionId: 301, optionName: "Ham", qty: 2, unitPrice: "3000.00", independentQty: true }],
  }]);
  assert.equal(row.total, 16000);
});

test("keeps orphan components identifiable without hiding separately ordered menus", () => {
  const rows = buildOrderSummaryRows([
    { orderId: 1, orderItemId: 10, parentOrderItemId: null, menuId: 7, itemType: "NORMAL", itemName: "Stew",
      qty: 1, effectiveQty: 0, unitPrice: "12000.00", totalAmount: "12000.00", options: [] },
    { orderId: 1, orderItemId: 11, parentOrderItemId: 10, menuId: 99, itemType: "COMPONENT", itemName: "Rice",
      qty: 2, actualComponentQty: 2, effectiveQty: 2, unitPrice: "0.00", totalAmount: "0.00", options: [] },
    { orderId: 1, orderItemId: 12, parentOrderItemId: null, menuId: 99, itemType: "NORMAL", itemName: "Rice",
      qty: 1, effectiveQty: 1, unitPrice: "2000.00", totalAmount: "2000.00", options: [] },
  ]);

  assert.deepEqual(rows.map(row => [row.itemType, row.name, row.qty, row.total]), [
    ["COMPONENT", "Rice", 2, 0],
    ["NORMAL", "Rice", 1, 2000],
  ]);
});

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

test("summary merges the same menu, option, price, and component recipe across orders", () => {
  const base = { menuId: 7, itemType: "NORMAL", itemName: "찌개", unitPrice: "10000.00", totalAmount: "20000.00" };
  const rows = buildOrderSummaryRows([
    { ...base, orderId: 1, orderItemId: 11, parentOrderItemId: null, qty: 2, effectiveQty: 2,
      options: [{ modifierOptionId: 3, optionName: "약간매운맛", qty: 2, unitPrice: "0.00" }] },
    { ...base, orderId: 1, orderItemId: 12, parentOrderItemId: 11, menuId: 99, itemType: "COMPONENT", itemName: "공기밥",
      qty: 4, actualComponentQty: 4, effectiveQty: 4, unitPrice: "0.00", totalAmount: "0.00", options: [] },
    { ...base, orderId: 2, orderItemId: 21, parentOrderItemId: null, qty: 1, effectiveQty: 1, totalAmount: "10000.00",
      options: [{ modifierOptionId: 3, optionName: "약간매운맛", qty: 1, unitPrice: "0.00" }] },
    { ...base, orderId: 2, orderItemId: 22, parentOrderItemId: 21, menuId: 99, itemType: "COMPONENT", itemName: "공기밥",
      qty: 2, actualComponentQty: 2, effectiveQty: 2, unitPrice: "0.00", totalAmount: "0.00", options: [] },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].qty, 3);
  assert.equal(rows[0].total, 30000);
  assert.equal(rows[0].components.length, 1);
  assert.equal(rows[0].components[0].qty, 6);
  assert.deepEqual(rows[0].sourceOrderItemIds, [11, 21]);
  assert.deepEqual(rows[0].components[0].sourceOrderItemIds, [12, 22]);
});

test("summary keeps different component recipes in separate parent rows", () => {
  const base = { menuId: 7, itemType: "NORMAL", itemName: "찌개", unitPrice: "10000.00", totalAmount: "10000.00" };
  const rows = buildOrderSummaryRows([
    { ...base, orderId: 1, orderItemId: 11, parentOrderItemId: null, qty: 1, effectiveQty: 1, options: [] },
    { ...base, orderId: 1, orderItemId: 12, parentOrderItemId: 11, menuId: 99, itemType: "COMPONENT", itemName: "공기밥",
      qty: 1, actualComponentQty: 1, effectiveQty: 1, unitPrice: "0.00", totalAmount: "0.00", options: [] },
    { ...base, orderId: 2, orderItemId: 21, parentOrderItemId: null, qty: 1, effectiveQty: 1, options: [] },
    { ...base, orderId: 2, orderItemId: 22, parentOrderItemId: 21, menuId: 99, itemType: "COMPONENT", itemName: "공기밥",
      qty: 2, actualComponentQty: 2, effectiveQty: 2, unitPrice: "0.00", totalAmount: "0.00", options: [] },
  ]);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => [row.qty, row.components[0]?.qty]), [[1, 1], [1, 2]]);
});

test("summary normalizes option order but separates different actual selling prices", () => {
  const base = { parentOrderItemId: null, menuId: 7, itemType: "NORMAL", itemName: "찌개", unitPrice: "10000.00" };
  const rows = buildOrderSummaryRows([
    { ...base, orderId: 1, orderItemId: 11, qty: 1, effectiveQty: 1, totalAmount: "13000.00",
      options: [{ modifierOptionId: 2, optionName: "곱빼기", qty: 1, unitPrice: "2000.00" }, { modifierOptionId: 1, optionName: "약간매운맛", qty: 1, unitPrice: "1000.00" }] },
    { ...base, orderId: 2, orderItemId: 21, qty: 1, effectiveQty: 1, totalAmount: "13000.00",
      options: [{ modifierOptionId: 1, optionName: "약간매운맛", qty: 1, unitPrice: "1000.00" }, { modifierOptionId: 2, optionName: "곱빼기", qty: 1, unitPrice: "2000.00" }] },
    { ...base, orderId: 3, orderItemId: 31, qty: 1, effectiveQty: 1, totalAmount: "12500.00",
      options: [{ modifierOptionId: 2, optionName: "곱빼기", qty: 1, unitPrice: "2000.00" }, { modifierOptionId: 1, optionName: "약간매운맛", qty: 1, unitPrice: "1000.00" }] },
  ]);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => [row.qty, row.total]), [[2, 26000], [1, 12500]]);
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
