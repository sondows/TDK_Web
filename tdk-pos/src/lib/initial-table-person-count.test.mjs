import assert from "node:assert/strict";
import test from "node:test";
import { initialAdultCountFromStewOrder } from "./initial-table-person-count.ts";

test("first-order headcount remains based on the stew category ID after its display name becomes 찌개", () => {
  const cart = [{ menuId: 1, qty: 2 }, { menuId: 2, qty: 1 }, { menuId: 3, qty: 4 }];
  const menus = [
    { menuId: 1, categoryId: 10 },
    { menuId: 2, categoryId: 20 },
    { menuId: 3, categoryId: null },
  ];
  const categories = [
    { categoryId: 10, name: "찌개" },
    { categoryId: 20, name: "사이드" },
  ];

  assert.equal(initialAdultCountFromStewOrder(cart, menus, categories), 2);
});

test("legacy 김치찌개 category rows keep the existing first-order headcount behavior", () => {
  assert.equal(initialAdultCountFromStewOrder(
    [{ menuId: 1, qty: 3 }],
    [{ menuId: 1, categoryId: 10 }],
    [{ categoryId: 10, name: "김치찌개" }],
  ), 3);
});
