import assert from "node:assert/strict";
import test from "node:test";
import {
  addQrCartLine, defaultQrSelections, groupQrModifiers, normalizeQrCart, qrCartTotal,
  qrLocaleFromPreferences, qrMenusForCategory, QR_CART_STORAGE_KEY, QR_LOCALE_STORAGE_KEY, validQrSelections,
} from "./qr-menu-cart.ts";

const rows = [
  { menuId: 7, modifierGroupId: 10, name: "매운맛", minSelect: 1, maxSelect: 1, isRequired: true,
    defaultOptionId: 12, modifierOptionId: 13, optionName: "3.매운맛", priceDelta: "0", groupSortOrder: 1, optionSortOrder: 2 },
  { menuId: 7, modifierGroupId: 10, name: "매운맛", minSelect: 1, maxSelect: 1, isRequired: true,
    defaultOptionId: 12, modifierOptionId: 12, optionName: "2.약간매운맛", priceDelta: "0", groupSortOrder: 1, optionSortOrder: 1 },
  { menuId: 7, modifierGroupId: 20, name: "추가", minSelect: 0, maxSelect: 2, isRequired: false,
    defaultOptionId: null, modifierOptionId: 21, optionName: "치즈", priceDelta: "1500", groupSortOrder: 2, optionSortOrder: 1 },
  { menuId: 7, modifierGroupId: 20, name: "추가", minSelect: 0, maxSelect: 2, isRequired: false,
    defaultOptionId: null, modifierOptionId: 22, optionName: "두부", priceDelta: "500", groupSortOrder: 2, optionSortOrder: 2 },
];
const menu = { menuId: 7, categoryId: 3, name: "김치찌개", price: "10000", imageUrl: "/qr.webp", groups: groupQrModifiers(rows, 7) };
const catalog = { categories: [{ categoryId: 3, name: "찌개" }, { categoryId: 4, name: "단품" }], menus: [menu] };

test("QR category order and menu IDs remain the source catalog order; modifiers group in configured order", () => {
  assert.deepEqual(catalog.categories.map(category => category.categoryId), [3, 4]);
  assert.deepEqual(qrMenusForCategory(catalog, 3).map(item => item.menuId), [7]);
  assert.deepEqual(qrMenusForCategory(catalog, 4), []);
  assert.deepEqual(menu.groups.map(group => group.modifierGroupId), [10, 20]);
  assert.deepEqual(menu.groups[0].options.map(option => option.modifierOptionId), [12, 13]);
  assert.deepEqual(groupQrModifiers(rows, 999), []);
});

test("browser language preference maps to supported locales and falls back to Korean", () => {
  assert.equal(qrLocaleFromPreferences(["fr-FR", "zh-TW"]), "zh-CN");
  assert.equal(qrLocaleFromPreferences(["ja-JP", "en-US"]), "ja");
  assert.equal(qrLocaleFromPreferences(["en-GB"]), "en");
  assert.equal(qrLocaleFromPreferences(["ko-KR"]), "ko");
  assert.equal(qrLocaleFromPreferences(["fr-FR"]), "ko");
  assert.equal(QR_CART_STORAGE_KEY, "tdkon:qr-cart:v1");
  assert.equal(QR_LOCALE_STORAGE_KEY, "tdkon:qr-locale:v1");
});

test("HOS option defaults are reused, and required/multi-select constraints are validated", () => {
  const defaults = defaultQrSelections(menu.groups);
  assert.deepEqual(defaults[10], [12]);
  assert.deepEqual(defaults[20], []);
  assert.equal(validQrSelections(menu.groups, defaults), true);
  assert.equal(validQrSelections(menu.groups, { 10: [], 20: [21] }), false);
  assert.equal(validQrSelections(menu.groups, { 10: [12], 20: [21, 22] }), true);
  assert.equal(validQrSelections(menu.groups, { 10: [12], 20: [21, 22, 21] }), false);
});

test("cart combines identical menu/options only, updates current catalog price, and restores safe quantities", () => {
  const defaultLine = { menuId: 7, qty: 2, options: [{ modifierOptionId: 12, qty: 1 }] };
  const sameLine = { menuId: 7, qty: 1, options: [{ modifierOptionId: 12, qty: 1 }] };
  const cheeseLine = { menuId: 7, qty: 1, options: [{ modifierOptionId: 12, qty: 1 }, { modifierOptionId: 21, qty: 1 }] };
  const combined = addQrCartLine([defaultLine], sameLine);
  const cart = addQrCartLine(combined, cheeseLine);
  assert.equal(cart.length, 2);
  assert.equal(cart[0].qty, 3);
  assert.equal(qrCartTotal(cart, [menu]), 41_500);

  const restored = normalizeQrCart([...cart, { menuId: 99, qty: 1, options: [] },
    { menuId: 7, qty: 101, options: [] }, { menuId: 7, qty: 1, options: [{ modifierOptionId: 999, qty: 1 }] }], catalog);
  assert.deepEqual(restored, cart);
  assert.deepEqual(normalizeQrCart("invalid", catalog), []);
});
