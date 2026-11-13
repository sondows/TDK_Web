export type MenuCategoryNameRow = { categoryId: number; name: string };

export function normalizeMenuCategoryName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length > 0 && name.length <= 100 ? name : null;
}

export function hasDuplicateMenuCategoryName(
  name: string,
  categories: MenuCategoryNameRow[],
  exceptCategoryId?: number,
) {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").normalize("NFC").toLocaleLowerCase("ko-KR");
  const normalized = normalize(name);
  return categories.some(category => category.categoryId !== exceptCategoryId &&
    normalize(category.name) === normalized);
}

export function reorderMenuCategoryIds(
  categoryIds: number[],
  categoryId: number,
  direction: "up" | "down",
) {
  const from = categoryIds.indexOf(categoryId);
  const to = from + (direction === "up" ? -1 : 1);
  if (from < 0 || to < 0 || to >= categoryIds.length) return null;
  const reordered = [...categoryIds];
  [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
  return reordered;
}
