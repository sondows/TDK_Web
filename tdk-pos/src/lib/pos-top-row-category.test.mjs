import assert from "node:assert/strict";
import { test } from "node:test";
import { getAdjacentPosCategoryId, getPosCategoryCornerColor, getPosCategorySwipeDirection, getPosCategoryTextColor, getPosCategoryWheelDirection, getPosMenuCardBackground, getPosMenuCategoryBottomPadding, getPosTopRowCategoryId, groupPosMenusIntoCategoryRows } from "./pos-top-row-category.ts";

test("POS menu card pastel keeps the ADM hue with 12% color and 88% white", () => {
  assert.equal(getPosMenuCardBackground("#a9d9c8", "#16A34A"), "#F5FAF8");
  assert.equal(getPosMenuCardBackground(null, "#16A34A"), "color-mix(in srgb, #16A34A 7%, white)");
  assert.equal(getPosMenuCardBackground("invalid", "#16A34A"), "color-mix(in srgb, #16A34A 7%, white)");
});

test("category corner marker uses an 18% same-hue darkening", () => {
  assert.equal(getPosCategoryCornerColor("#a9d9c8", "#16A34A"), "#8BB2A4");
  assert.equal(getPosCategoryCornerColor(null, "#16A34A"), "#12863D");
  assert.equal(getPosCategoryCornerColor("invalid", "#16A34A"), "#12863D");
});

test("active category text chooses the more legible neutral color", () => {
  assert.equal(getPosCategoryTextColor("#F4BFC7", "#16A34A"), "#000000");
  assert.equal(getPosCategoryTextColor("#1F2937", "#16A34A"), "#FFFFFF");
  assert.equal(getPosCategoryTextColor(null, "#16A34A"), "#000000");
});

test("restored source category colors produce bright corners and light card pastels", () => {
  const colors = ["#AC1E1E", "#117F3A", "#B8860B", "#B64509", "#06718B", "#612DB9"];
  assert.deepEqual(colors.map(color => getPosCategoryCornerColor(color, color)), [
    "#8D1919", "#0E6830", "#976E09", "#953907", "#055D72", "#502598",
  ]);
  assert.deepEqual(colors.map(color => getPosMenuCardBackground(color, color)), [
    "#F5E4E4", "#E2F0E7", "#F6F0E2", "#F6E9E1", "#E1EEF1", "#ECE6F7",
  ]);
  assert.deepEqual(colors.map(color => getPosCategoryTextColor(color, color)), [
    "#FFFFFF", "#FFFFFF", "#000000", "#FFFFFF", "#FFFFFF", "#FFFFFF",
  ]);
});

test("category rows keep every category on its own 3-column row sequence", () => {
  const menus = [
    ...Array.from({ length: 5 }, (_, index) => ({ id: `side-${index + 1}`, categoryId: 20 })),
    ...Array.from({ length: 2 }, (_, index) => ({ id: `rice-${index + 1}`, categoryId: 30 })),
    ...Array.from({ length: 4 }, (_, index) => ({ id: `stew-${index + 1}`, categoryId: 10 })),
  ];
  const rows = groupPosMenusIntoCategoryRows(menus, [10, 20, 30]);
  assert.deepEqual(rows.map(row => [row.categoryId, row.menus.map(menu => menu.id)]), [
    [10, ["stew-1", "stew-2", "stew-3"]],
    [10, ["stew-4"]],
    [20, ["side-1", "side-2", "side-3"]],
    [20, ["side-4", "side-5"]],
    [30, ["rice-1", "rice-2"]],
  ]);
  assert.ok(rows.every(row => row.menus.length > 0 && row.menus.length <= 3));
});

test("one- and two-menu categories start a fresh row without placeholder menu items", () => {
  const menus = [
    { id: 1, categoryId: 1 },
    { id: 2, categoryId: 1 },
    { id: 3, categoryId: 2 },
    { id: 4, categoryId: 3 },
  ];
  const rows = groupPosMenusIntoCategoryRows(menus, [1, 2, 3]);
  assert.deepEqual(rows.map(row => [row.categoryId, row.menus.map(menu => menu.id)]), [
    [1, [1, 2]],
    [2, [3]],
    [3, [4]],
  ]);
});

test("left and right input move to the adjacent category in that physical direction", () => {
  const categories = [11, 22, 33, 44];
  assert.equal(getAdjacentPosCategoryId(categories, 33, "PREVIOUS"), 22);
  assert.equal(getAdjacentPosCategoryId(categories, 33, "NEXT"), 44);
  assert.equal(getAdjacentPosCategoryId(categories, 11, "PREVIOUS"), null);
  assert.equal(getAdjacentPosCategoryId(categories, 44, "NEXT"), null);
  assert.equal(getAdjacentPosCategoryId(categories, 999, "NEXT"), null);
});

test("touch swipes require a clear horizontal move and follow finger direction", () => {
  assert.equal(getPosCategorySwipeDirection(160, 100, 90, 108), "PREVIOUS");
  assert.equal(getPosCategorySwipeDirection(90, 100, 160, 108), "NEXT");
  assert.equal(getPosCategorySwipeDirection(160, 100, 130, 108), null);
  assert.equal(getPosCategorySwipeDirection(160, 100, 90, 180), null);
});

test("horizontal wheel maps left/right input to previous/next categories", () => {
  assert.equal(getPosCategoryWheelDirection(-55, 4), "PREVIOUS");
  assert.equal(getPosCategoryWheelDirection(55, 4), "NEXT");
  assert.equal(getPosCategoryWheelDirection(10, 80), null);
});

test("top-row focus follows the row crossing the scroll container focus line", () => {
  const rows = [
    { top: 100, bottom: 200, firstCategoryId: 10 },
    { top: 210, bottom: 310, firstCategoryId: 20 },
    { top: 320, bottom: 420, firstCategoryId: 30 },
  ];
  assert.equal(getPosTopRowCategoryId(rows, 108), 10);
  assert.equal(getPosTopRowCategoryId(rows, 208), 20);
  assert.equal(getPosTopRowCategoryId(rows, 315), 30);
  assert.equal(getPosTopRowCategoryId(rows, 421), 30);
});

test("a mixed-category row uses its leftmost menu category", () => {
  const row = { top: 40, bottom: 140, firstCategoryId: 12 };
  assert.equal(getPosTopRowCategoryId([row], 60), 12);
});

test("empty rows or invalid focus positions do not select a category", () => {
  assert.equal(getPosTopRowCategoryId([], 0), null);
  assert.equal(getPosTopRowCategoryId([{ top: 0, bottom: 100, firstCategoryId: 1 }], Number.NaN), null);
});

test("bottom spacer is the minimum needed to align category starts at the scrollport top", () => {
  assert.equal(getPosMenuCategoryBottomPadding([80, 220, 540], 700, 300), 140);
  assert.equal(getPosMenuCategoryBottomPadding([80, 220], 700, 300), 0);
  assert.equal(getPosMenuCategoryBottomPadding([], 700, 300), 0);
  assert.equal(getPosMenuCategoryBottomPadding([500], 700, 0), 0);
});
