import assert from "node:assert/strict";
import test from "node:test";
import {
  addQrCartLine, defaultQrSelections, formatQrCartPrice, groupQrModifiers, normalizeQrCart, qrCartItemCount, qrCartTotal, qrLineItemCount, qrLineTotal, qrLineUnitPrice,
  qrLocaleFromPreferences, qrMenusForCategory, QR_CART_STORAGE_KEY, QR_LOCALE_STORAGE_KEY, validQrSelections, isQrSpiceGroupName, selectedQrOptions,
  qrMenuAddonGroups, qrOtherOptionalGroups, splitQrCartAddonLines, qrImmediateAddLine,
} from "./qr-menu-cart.ts";

const rows = [
  { menuId: 7, modifierGroupId: 10, name: "매운맛", minSelect: 1, maxSelect: 1, isRequired: true,
    defaultOptionId: 12, modifierOptionId: 13, optionName: "3.매운맛", qrDescription: "QR spicy description", priceDelta: "0", groupSortOrder: 1, optionSortOrder: 2 },
  { menuId: 7, modifierGroupId: 10, name: "매운맛", minSelect: 1, maxSelect: 1, isRequired: true,
    defaultOptionId: 12, modifierOptionId: 12, optionName: "2.약간매운맛", priceDelta: "0", groupSortOrder: 1, optionSortOrder: 1 },
  { menuId: 7, modifierGroupId: 20, name: "추가", minSelect: 0, maxSelect: 2, isRequired: false,
    defaultOptionId: null, modifierOptionId: 21, optionName: "치즈", priceDelta: "1500", groupSortOrder: 2, optionSortOrder: 1 },
  { menuId: 7, modifierGroupId: 20, name: "추가", minSelect: 0, maxSelect: 2, isRequired: false,
    defaultOptionId: null, modifierOptionId: 22, optionName: "두부", priceDelta: "500", groupSortOrder: 2, optionSortOrder: 2 },
];
const menu = { menuId: 7, categoryId: 3, name: "김치찌개", price: "10000", imageUrl: "/qr.webp", groups: groupQrModifiers(rows, 7) };
const catalog = { categories: [{ categoryId: 3, name: "찌개" }, { categoryId: 4, name: "단품" }], menus: [menu] };

test("cart badge quantity sums line quantities, including option-specific duplicate menu lines", () => {
  assert.equal(qrCartItemCount([]), 0);
  assert.equal(qrCartItemCount([{ qty: 1 }]), 1);
  assert.equal(qrCartItemCount([{ menuId: 7, qty: 2, options: [] },
    { menuId: 7, qty: 1, options: [{ modifierOptionId: 21, qty: 1 }] }]), 3);
  assert.equal(qrCartItemCount([{ qty: 3 }, { qty: 2 }, { qty: 1 }]), 6);
});

test("QR cart price formatting uses a trailing won unit without a currency symbol", () => {
  assert.equal(formatQrCartPrice(16000), "16,000원");
  assert.equal(formatQrCartPrice(10000), "10,000원");
  assert.equal(formatQrCartPrice(Number.NaN), "0원");
});

test("ADM spice group title 맵기 선택 activates the QR spice selector and its fallback default", () => {
  assert.equal(isQrSpiceGroupName("맵기 선택"), true);
  assert.equal(isQrSpiceGroupName("  맵기   선택  "), true);
  assert.equal(isQrSpiceGroupName("매운맛"), true);
  const spiceGroups = groupQrModifiers([
    { menuId: 8, modifierGroupId: 90, name: "맵기 선택", minSelect: 1, maxSelect: 1, isRequired: true,
      defaultOptionId: null, modifierOptionId: 31, optionName: "3.매운맛", priceDelta: "0", groupSortOrder: 1, optionSortOrder: 2 },
    { menuId: 8, modifierGroupId: 90, name: "맵기 선택", minSelect: 1, maxSelect: 1, isRequired: true,
      defaultOptionId: null, modifierOptionId: 30, optionName: "2.약간매운맛", priceDelta: "0", groupSortOrder: 1, optionSortOrder: 1 },
  ], 8);
  assert.deepEqual(defaultQrSelections(spiceGroups)[90], [30]);
});

test("QR category order and menu IDs remain the source catalog order; modifiers group in configured order", () => {
  assert.deepEqual(catalog.categories.map(category => category.categoryId), [3, 4]);
  assert.deepEqual(qrMenusForCategory(catalog, 3).map(item => item.menuId), [7]);
  assert.deepEqual(qrMenusForCategory(catalog, 4), []);
  assert.deepEqual(menu.groups.map(group => group.modifierGroupId), [10, 20]);
  assert.deepEqual(menu.groups[0].options.map(option => option.modifierOptionId), [12, 13]);
  assert.equal(menu.groups[0].options[1].qrDescription, 'QR spicy description');
  assert.equal(menu.groups[0].options[0].qrDescription, '');
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

test("quick-add uses configured defaults and requests detail when a required choice is missing", () => {
  const defaults = defaultQrSelections(menu.groups);
  assert.deepEqual(qrImmediateAddLine(menu, defaults), { menuId: 7, qty: 1, options: [{ modifierOptionId: 12, qty: 1 }] });
  const requiredGroups = groupQrModifiers([
    { menuId: 8, modifierGroupId: 80, name: "Required", minSelect: 1, maxSelect: 1, isRequired: true,
      defaultOptionId: null, modifierOptionId: 81, optionName: "Choice A", priceDelta: "500", groupSortOrder: 1, optionSortOrder: 1 },
    { menuId: 8, modifierGroupId: 80, name: "Required", minSelect: 1, maxSelect: 1, isRequired: true,
      defaultOptionId: null, modifierOptionId: 82, optionName: "Choice B", priceDelta: "1000", groupSortOrder: 1, optionSortOrder: 2 },
  ], 8);
  assert.equal(qrImmediateAddLine({ ...menu, menuId: 8, groups: requiredGroups }, {}), null);
});

test("QR per-menu add-ons have independent quantities and do not inherit the old four-item selection limit", () => {
  const addonRows = [301, 302, 303, 304, 305].map((modifierOptionId, index) => ({
    menuId: 7, modifierGroupId: 30, name: "addon", minSelect: 0, maxSelect: 4, isRequired: false,
    defaultOptionId: null, modifierOptionId, optionName: "addon " + modifierOptionId,
    priceDelta: ["1000.00", "6000.00", "3000.00", "1000.00", "500.00"][index], groupSortOrder: 9,
    optionSortOrder: (index + 1) * 10, source: "MENU_ADDON",
  }));
  const groups = groupQrModifiers(addonRows, 7);
  const addonMenu = { ...menu, groups };
  assert.equal(qrLineUnitPrice(addonMenu, [{ modifierOptionId: 301, qty: 2 }]), 10000);
  assert.equal(qrLineTotal(addonMenu, [{ modifierOptionId: 301, qty: 2 }], 1), 12000);
  assert.equal(validQrSelections(groups, { 30: [301, 302, 303, 304, 305] }), true);
  const mixedMenu = { ...menu, groups: [...menu.groups, ...groups] };
  const choices = [{ modifierOptionId: 13, qty: 1 }, { modifierOptionId: 21, qty: 1 },
    { modifierOptionId: 301, qty: 2 }, { modifierOptionId: 304, qty: 1 }];
  assert.equal(qrLineTotal(mixedMenu, choices, 2), 26000);
  assert.equal(qrLineItemCount(mixedMenu, 2, choices), 5);
  assert.equal(qrCartTotal([{ menuId: 7, qty: 2, options: choices }], [mixedMenu]), 26000);
  const mergedAdditions = addQrCartLine([
    { menuId: 7, qty: 2, options: [{ modifierOptionId: 301, qty: 1 }] },
  ], { menuId: 7, qty: 1, options: [{ modifierOptionId: 301, qty: 2 }] }, addonMenu);
  assert.deepEqual(mergedAdditions, [{ menuId: 7, qty: 3, options: [{ modifierOptionId: 301, qty: 3 }] }]);
  assert.deepEqual(normalizeQrCart([{ menuId: 7, qty: 2, options: choices }], { ...catalog, menus: [mixedMenu] }),
    [{ menuId: 7, qty: 2, options: choices }]);
  assert.deepEqual(normalizeQrCart([{ menuId: 7, qty: 1, options: [{ modifierOptionId: 301, qty: 100 }] }],
    { ...catalog, menus: [addonMenu] }), []);
});
test("menu별 추가 is sourced only from ADM-linked groups; other optional settings stay separate", () => {
  const groups = groupQrModifiers([
    { menuId: 7, modifierGroupId: 50, name: "메뉴별 추가", minSelect: 0, maxSelect: 4, isRequired: false,
      defaultOptionId: null, modifierOptionId: 501, optionName: "ADM 추가", priceDelta: "2500", groupSortOrder: 1, optionSortOrder: 1, source: "MENU_ADDON" },
    { menuId: 7, modifierGroupId: 51, name: "추가", minSelect: 0, maxSelect: 2, isRequired: false,
      defaultOptionId: null, modifierOptionId: 511, optionName: "기존 옵션", priceDelta: "500", groupSortOrder: 2, optionSortOrder: 1, source: "OPTION" },
  ], 7);
  assert.deepEqual(qrMenuAddonGroups(groups).map(group => group.options.map(option => option.optionName)), [["ADM 추가"]]);
  assert.deepEqual(qrOtherOptionalGroups(groups).map(group => group.options.map(option => option.optionName)), [["기존 옵션"]]);
});

test("display-only divider and spacer entries never become selectable or affect cart totals", () => {
  const groups = groupQrModifiers([{
    menuId: 7, modifierGroupId: 30, name: "addon", minSelect: 0, maxSelect: 4, isRequired: false,
    defaultOptionId: null, modifierOptionId: 301, optionName: "Ham", priceDelta: "3000", groupSortOrder: 9,
    optionSortOrder: 10, source: "MENU_ADDON",
  }], 7);
  const decoratedMenu = {
    ...menu,
    groups,
    addonDisplayEntries: [
      { type: "menu", entryId: 301, menuId: 8, name: "Ham", price: "3000", isQrVisible: true },
      { type: "divider", entryId: 302 },
      { type: "spacer", entryId: 303 },
    ],
  };
  const markerSelection = { 30: [302] };
  assert.equal(validQrSelections(groups, markerSelection), false);
  assert.deepEqual(selectedQrOptions(groups, {}), []);
  assert.deepEqual(normalizeQrCart([{ menuId: 7, qty: 1, options: [{ modifierOptionId: 302, qty: 1 }] }],
    { ...catalog, menus: [decoratedMenu] }), []);
  assert.equal(qrLineTotal(decoratedMenu, [], 1), 10000);
  assert.equal(qrLineItemCount(decoratedMenu, 1, []), 1);
});

test("legacy bundled QR add-ons split into independent menu lines without changing the total", () => {
  const addonGroup = groupQrModifiers([{
    menuId: 7, modifierGroupId: 40, name: "메뉴별 추가", minSelect: 0, maxSelect: 4, isRequired: false,
    defaultOptionId: null, modifierOptionId: 401, optionName: "햄사리", priceDelta: "3000",
    groupSortOrder: 4, optionSortOrder: 1, source: "MENU_ADDON",
  }, {
    menuId: 7, modifierGroupId: 40, name: "메뉴별 추가", minSelect: 0, maxSelect: 4, isRequired: false,
    defaultOptionId: null, modifierOptionId: 402, optionName: "라면사리", priceDelta: "1000",
    groupSortOrder: 4, optionSortOrder: 2, source: "MENU_ADDON",
  }], 7)[0];
  const parent = {
    ...menu,
    groups: [...menu.groups, addonGroup],
    addonDisplayEntries: [
      { type: "menu", entryId: 401, menuId: 8, name: "햄사리", price: "3000", isQrVisible: false },
      { type: "menu", entryId: 402, menuId: 9, name: "라면사리", price: "1000", isQrVisible: false },
    ],
  };
  const addon = { ...menu, menuId: 8, categoryId: null, name: "햄사리", price: "3000", groups: [], qrCartOnly: true };
  const secondAddon = { ...menu, menuId: 9, categoryId: null, name: "라면사리", price: "1000", groups: [], qrCartOnly: true };
  const oldBundledLine = { menuId: 7, qty: 1, options: [
    { modifierOptionId: 12, qty: 1 }, { modifierOptionId: 401, qty: 2 }, { modifierOptionId: 402, qty: 1 },
  ] };
  const split = splitQrCartAddonLines([oldBundledLine], { ...catalog, menus: [parent, addon, secondAddon] });
  assert.deepEqual(split, [
    { menuId: 7, qty: 1, options: [{ modifierOptionId: 12, qty: 1 }] },
    { menuId: 8, qty: 2, options: [] },
    { menuId: 9, qty: 1, options: [] },
  ]);
  assert.equal(qrCartTotal(split, [parent, addon, secondAddon]), 17_000);
  assert.equal(split.reduce((sum, line) => sum + line.qty, 0), 4);
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
