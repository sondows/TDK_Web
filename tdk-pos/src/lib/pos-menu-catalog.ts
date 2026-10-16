import "server-only";

import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { db } from "@/db";
import { menuCategories, menuComponents, menuImages, menuModifierGroups, menus, modifierGroups, modifierOptions } from "@/db/schema";

/** The same menu data used for the first POS render and subsequent refreshes. */
export async function loadPosMenuCatalog() {
  const componentMenu = alias(menus, "component_menu");
  const [activeMenus, activeCategories, activeMenuModifiers, activeMenuComponents] = await Promise.all([
    db.select({ menuId: menus.menuId, categoryId: menus.categoryId, menuNumber: menus.menuNumber, name: menus.posName, price: menus.price, categoryName: menuCategories.posName, imageUrl: menuImages.imageUrl }).from(menus).leftJoin(menuCategories, eq(menus.categoryId, menuCategories.categoryId)).leftJoin(menuImages, and(eq(menuImages.menuId, menus.menuId), eq(menuImages.imageType, "POS"), eq(menuImages.isActive, 1))).where(eq(menus.isActive, 1)).orderBy(menuCategories.sortOrder, menus.sortOrder, menus.menuId, menuImages.menuImageId),
    db.select({ categoryId: menuCategories.categoryId, name: menuCategories.posName }).from(menuCategories).where(eq(menuCategories.isActive, 1)).orderBy(menuCategories.sortOrder, menuCategories.categoryId),
    db.select({ menuId: menuModifierGroups.menuId, modifierGroupId: modifierGroups.modifierGroupId, groupName: modifierGroups.posName, groupSortOrder: modifierGroups.sortOrder, modifierOptionId: modifierOptions.modifierOptionId, optionName: modifierOptions.posName, priceDelta: modifierOptions.priceDelta, optionSortOrder: modifierOptions.sortOrder }).from(menuModifierGroups).innerJoin(modifierGroups, and(eq(menuModifierGroups.modifierGroupId, modifierGroups.modifierGroupId), eq(modifierGroups.isActive, 1))).innerJoin(modifierOptions, and(eq(modifierGroups.modifierGroupId, modifierOptions.modifierGroupId), eq(modifierOptions.isActive, 1))).orderBy(menuModifierGroups.menuId, menuModifierGroups.sortOrder, modifierGroups.sortOrder, modifierOptions.sortOrder, modifierOptions.modifierOptionId),
    db.select({ menuComponentId: menuComponents.menuComponentId, menuId: menuComponents.parentMenuId, componentMenuId: componentMenu.menuId, itemName: componentMenu.posName, price: componentMenu.price, quantity: menuComponents.qtyPerUnit, printOnKitchen: menuComponents.printOnKitchen, printOnReceipt: menuComponents.printOnReceipt, sortOrder: menuComponents.sortOrder }).from(menuComponents).innerJoin(componentMenu, and(eq(componentMenu.menuId, menuComponents.componentMenuId), eq(componentMenu.isActive, 1))).orderBy(menuComponents.parentMenuId, menuComponents.sortOrder, menuComponents.menuComponentId),
  ]);
  return { menus: activeMenus, categories: activeCategories, modifiers: activeMenuModifiers, components: activeMenuComponents };
}
