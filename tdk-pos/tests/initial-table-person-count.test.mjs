import assert from "node:assert/strict";
import test from "node:test";
import { initialAdultCountFromStewOrder } from "../src/lib/initial-table-person-count.ts";

const categories = [
  { categoryId: 7, name: "김치찌개" },
  { categoryId: 8, name: "사이드" },
  { categoryId: 9, name: "주류·음료" },
];
const menus = [
  { menuId: 11, categoryId: 7 },
  { menuId: 12, categoryId: 7 },
  { menuId: 21, categoryId: 8 },
  { menuId: 31, categoryId: 9 },
];

test("first stew order initializes the adult count from the selected serving quantity", () => {
  for (const qty of [1, 2, 3, 4]) {
    assert.equal(initialAdultCountFromStewOrder([{ menuId: 11, qty }], menus, categories), qty);
  }
});

test("only stew category quantities contribute, including multiple stew menus", () => {
  assert.equal(initialAdultCountFromStewOrder([
    { menuId: 11, qty: 2 },
    { menuId: 12, qty: 1 },
    { menuId: 21, qty: 3 },
    { menuId: 31, qty: 2 },
  ], menus, categories), 3);
  assert.equal(initialAdultCountFromStewOrder([{ menuId: 21, qty: 2 }], menus, categories), 0);
});

test("classification follows the category ID, independent of the menu name", () => {
  assert.equal(initialAdultCountFromStewOrder([{ menuId: 99, qty: 2 }], [
    { menuId: 99, categoryId: 7 },
  ], categories), 2);
  assert.equal(initialAdultCountFromStewOrder([{ menuId: 99, qty: 2 }], [
    { menuId: 99, categoryId: 8 },
  ], categories), 0);
});
