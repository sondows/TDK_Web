import assert from "node:assert/strict";
import test from "node:test";
import { hasDuplicateMenuCategoryName, normalizeMenuCategoryName, reorderMenuCategoryIds } from "./menu-category-policy.ts";

test("category names trim and collapse whitespace and reject empty or oversized names", () => {
  assert.equal(normalizeMenuCategoryName("  사리   · 밥  "), "사리 · 밥");
  assert.equal(normalizeMenuCategoryName("   "), null);
  assert.equal(normalizeMenuCategoryName("x".repeat(101)), null);
});

test("category name comparison rejects normalized duplicates but permits keeping its own name", () => {
  const categories = [{ categoryId: 1, name: "사이드" }, { categoryId: 2, name: "음료" }];
  assert.equal(hasDuplicateMenuCategoryName("  사이드  ", categories), true);
  assert.equal(hasDuplicateMenuCategoryName("사이드", categories, 1), false);
  assert.equal(hasDuplicateMenuCategoryName("사리·밥", categories), false);
});

test("category reorder swaps only neighboring IDs and reports boundary moves", () => {
  assert.deepEqual(reorderMenuCategoryIds([8, 5, 3], 5, "up"), [5, 8, 3]);
  assert.deepEqual(reorderMenuCategoryIds([8, 5, 3], 5, "down"), [8, 3, 5]);
  assert.equal(reorderMenuCategoryIds([8, 5, 3], 8, "up"), null);
  assert.equal(reorderMenuCategoryIds([8, 5, 3], 9, "down"), null);
});
