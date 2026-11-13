import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryTabContrastRatio, getMenuCategoryTabStyles, MENU_CATEGORY_TAB_PALETTE, normalizeMenuCategoryTabColor } from "./menu-category-tab-color.ts";

test("category tab color accepts only six-digit HEX and normalizes case", () => {
  assert.equal(normalizeMenuCategoryTabColor("#aBc123"), "#ABC123");
  for (const invalid of [null, undefined, "red", "#fff", "#12345678", " #123456", "#12GG56"]) {
    assert.equal(normalizeMenuCategoryTabColor(invalid), null);
  }
});

test("default palette uses the requested vivid colors", () => {
  assert.deepEqual(MENU_CATEGORY_TAB_PALETTE.map(({ hex }) => hex), [
    "#C62828", "#EF6C00", "#D4A017", "#7CB342", "#1E8E3E", "#00897B",
    "#1E88E5", "#2563EB", "#6D28D9", "#C2185B", "#9AA0A6",
  ]);
});

test("vivid palette colors are stored directly and active text remains readable", () => {
  for (const { hex } of MENU_CATEGORY_TAB_PALETTE) {
    const active = getMenuCategoryTabStyles(hex, true);
    const inactive = getMenuCategoryTabStyles(hex, false);
    assert.equal(active.backgroundColor, hex);
    assert.equal(inactive.backgroundColor, "transparent");
    assert.ok(categoryTabContrastRatio(active.color, active.backgroundColor) >= 4.5, `${hex} active contrast`);
    assert.ok(categoryTabContrastRatio(inactive.color, "#FFFFFF") >= 4.5, `${hex} inactive contrast`);
  }
});

test("unset category colors retain gray active fallback and transparent inactive style", () => {
  assert.deepEqual(getMenuCategoryTabStyles(null, true), { backgroundColor: "#E2E8F0", color: "#334155" });
  assert.deepEqual(getMenuCategoryTabStyles(null, false), { backgroundColor: "transparent", color: "#64748B" });
});
