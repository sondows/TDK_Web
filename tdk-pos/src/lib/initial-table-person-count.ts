type Menu = { menuId: number; categoryId: number | null };
type MenuCategory = { categoryId: number; name: string };
type CartItem = { menuId: number; qty: number };

const stewCategoryNames = new Set(["김치찌개", "찌개"]);

export function initialAdultCountFromStewOrder(
  cart: CartItem[],
  menus: Menu[],
  categories: MenuCategory[],
): number {
  const stewCategoryIds = new Set(categories.filter(category => stewCategoryNames.has(category.name)).map(category => category.categoryId));
  const countableMenuIds = new Set(menus.filter(menu => menu.categoryId !== null && stewCategoryIds.has(menu.categoryId)).map(menu => menu.menuId));
  return cart.reduce((total, item) => total + (countableMenuIds.has(item.menuId) ? item.qty : 0), 0);
}
