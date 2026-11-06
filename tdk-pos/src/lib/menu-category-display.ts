const menuCategoryDisplayNames: Record<string, string> = {
  "김치찌개": "찌개",
  사이드: "단품",
  "주류·음료": "음료",
};

export function menuCategoryDisplayName(name: string) {
  return menuCategoryDisplayNames[name] ?? name;
}
