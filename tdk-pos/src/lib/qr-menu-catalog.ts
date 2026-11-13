import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { menuCategories, menuImages, menuModifierGroups, menus, modifierGroups, modifierOptions } from "@/db/schema";

/** Customer-safe projection of the live menu catalog; never includes KDS or recipe data. */
export async function loadQrMenuCatalog() {
  const [categoryRows, menuRows] = await Promise.all([
    db.select({ categoryId: menuCategories.categoryId, name: menuCategories.posName, tabColor: menuCategories.tabColor })
      .from(menuCategories).where(eq(menuCategories.isActive, 1))
      .orderBy(menuCategories.sortOrder, menuCategories.categoryId),
    db.select({ menuId: menus.menuId, categoryId: menus.categoryId, name: menus.posName, price: menus.price })
      .from(menus).innerJoin(menuCategories, and(eq(menus.categoryId, menuCategories.categoryId), eq(menuCategories.isActive, 1)))
      .where(and(eq(menus.isActive, 1), eq(menus.isQrVisible, 1)))
      .orderBy(menuCategories.sortOrder, menus.sortOrder, menus.menuId),
  ]);
  const visibleCategoryIds = [...new Set(menuRows.map(menu => menu.categoryId).filter((id): id is number => id !== null))];
  const categories = categoryRows.filter(category => visibleCategoryIds.includes(category.categoryId));
  if (!menuRows.length) return { categories, menus: [], modifierGroups: [] };

  const menuIds = menuRows.map(menu => menu.menuId);
  const [imageRows, modifierRows] = await Promise.all([
    db.select({ menuId: menuImages.menuId, imageType: menuImages.imageType, imageUrl: menuImages.imageUrl, sortOrder: menuImages.sortOrder })
      .from(menuImages).where(and(inArray(menuImages.menuId, menuIds), inArray(menuImages.imageType, ["QR_THUMBNAIL", "QR_LARGE", "POS"]), eq(menuImages.isActive, 1)))
      .orderBy(menuImages.sortOrder, menuImages.menuImageId),
    db.select({ menuId: menuModifierGroups.menuId, modifierGroupId: modifierGroups.modifierGroupId,
      name: modifierGroups.posName, minSelect: modifierGroups.minSelect, maxSelect: modifierGroups.maxSelect,
      isRequired: modifierGroups.isRequired, groupSortOrder: menuModifierGroups.sortOrder,
      defaultOptionId: menuModifierGroups.posChoiceDefaultOptionId, modifierOptionId: modifierOptions.modifierOptionId,
      optionName: modifierOptions.posName, priceDelta: modifierOptions.priceDelta,
      optionSortOrder: modifierOptions.sortOrder })
      .from(menuModifierGroups)
      .innerJoin(menus, and(eq(menus.menuId, menuModifierGroups.menuId), eq(menus.isActive, 1), eq(menus.isQrVisible, 1)))
      .innerJoin(modifierGroups, and(eq(modifierGroups.modifierGroupId, menuModifierGroups.modifierGroupId), eq(modifierGroups.isActive, 1)))
      .innerJoin(modifierOptions, and(eq(modifierOptions.modifierGroupId, modifierGroups.modifierGroupId), eq(modifierOptions.isActive, 1)))
      .where(inArray(menuModifierGroups.menuId, menuIds))
      .orderBy(menuModifierGroups.menuId, menuModifierGroups.sortOrder, modifierGroups.sortOrder, modifierOptions.sortOrder, modifierOptions.modifierOptionId),
  ]);

  const imagesByMenu = new Map<number, typeof imageRows>();
  for (const image of imageRows) imagesByMenu.set(image.menuId, [...(imagesByMenu.get(image.menuId) ?? []), image]);
  const modifiersByMenu = new Map<number, typeof modifierRows>();
  for (const row of modifierRows) modifiersByMenu.set(row.menuId, [...(modifiersByMenu.get(row.menuId) ?? []), row]);
  const imagePriority = { QR_THUMBNAIL: 0, QR_LARGE: 1, POS: 2, OTHER: 3 } as const;
  return {
    categories,
    menus: menuRows.map(menu => {
      const image = [...(imagesByMenu.get(menu.menuId) ?? [])]
        .sort((a, b) => imagePriority[a.imageType] - imagePriority[b.imageType] || a.sortOrder - b.sortOrder)[0];
      return { ...menu, imageUrl: image?.imageUrl ?? null };
    }),
    modifierGroups: modifierRows.map(({ menuId, modifierGroupId, name, minSelect, maxSelect, isRequired,
      groupSortOrder, defaultOptionId, modifierOptionId, optionName, priceDelta, optionSortOrder }) => ({
      menuId, modifierGroupId, name, minSelect, maxSelect, isRequired: Boolean(isRequired), groupSortOrder,
      defaultOptionId, modifierOptionId, optionName, priceDelta, optionSortOrder,
    })),
  };
}
