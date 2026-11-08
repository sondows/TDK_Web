import test from "node:test";
import assert from "node:assert/strict";
import { getHosMenuCategoryAtTop, getHosMenuTailSpacerHeight } from "./hos-menu-scroll.ts";
import { menuCategoryDisplayName } from "./menu-category-display.ts";

test("HOS menu labels reuse the POS menu management category display names", () => {
  assert.deepEqual(["김치찌개", "사이드", "주류·음료", "추가", "포장"].map(menuCategoryDisplayName),
    ["찌개", "단품", "음료", "추가", "포장"]);
});

test("menu scrolling activates the section whose start has reached the list top", () => {
  const sections = [
    { categoryId: 10, top: 0 },
    { categoryId: 20, top: 245 },
    { categoryId: 30, top: 512 },
  ];
  assert.equal(getHosMenuCategoryAtTop(sections, 8), 10);
  assert.equal(getHosMenuCategoryAtTop(sections, 250), 20);
  assert.equal(getHosMenuCategoryAtTop(sections, 520), 30);
});

test("menu scroll tracking returns no active section when catalog sections are empty", () => {
  assert.equal(getHosMenuCategoryAtTop([], 0), null);
});

test("menu tail spacer provides only the missing scroll range to align the last section", () => {
  assert.equal(getHosMenuTailSpacerHeight(600, 400, 800), 200);
  assert.equal(getHosMenuTailSpacerHeight(600, 400, 1200), 0);
  assert.equal(getHosMenuTailSpacerHeight(600, 400, 950), 50);
});
