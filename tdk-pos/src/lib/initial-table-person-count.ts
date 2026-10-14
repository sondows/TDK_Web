type MenuCategory = { categoryId: number; name: string };
type Menu = { menuId: number; categoryId: number | null };
type CartItem = { menuId: number; qty: number };

// The POS displays the stored "김치찌개" category as "찌개".
const stewCategoryNames = new Set(["김치찌개", "찌개"]);

export function initialAdultCountFromStewOrder(
  cart: CartItem[],
  menus: Menu[],
  categories: MenuCategory[],
): number {
  const stewCategoryIds = new Set(categories.filter(category => stewCategoryNames.has(category.name)).map(category => category.categoryId));
  const stewMenuIds = new Set(menus.filter(menu => menu.categoryId !== null && stewCategoryIds.has(menu.categoryId)).map(menu => menu.menuId));
  return cart.reduce((total, item) => total + (stewMenuIds.has(item.menuId) ? item.qty : 0), 0);
}
