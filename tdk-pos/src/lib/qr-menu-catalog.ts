import "server-only";

import { and, eq, inArray, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { db } from "@/db";
import { menuCategories, menuImages, menuModifierGroups, menus, modifierGroups, modifierOptions, qrMenuDescriptions, qrMenuOriginItems, qrMenuOriginTranslations } from "@/db/schema";
import { QR_LEGACY_AUTO_ADDON_GROUP_NAME, QR_MENU_ADDON_GROUP_TITLE, isQrMenuAddonGroupForMenu, isQrMenuAddonGroupName, qrMenuAddonMarkerType, qrModifierSource, type QrMenuAddonDisplayEntry } from "@/lib/qr-menu-addon-model";

let missingQrMenuDescriptionSchemaLogged = false;

async function loadKoreanDescriptions(menuIds: number[]) {
  try {
    return await db.select({ menuId: qrMenuDescriptions.menuId, shortDescription: qrMenuDescriptions.shortDescription,
      detailDescription: qrMenuDescriptions.detailDescription, originDescription: qrMenuDescriptions.originDescription })
      .from(qrMenuDescriptions).where(and(inArray(qrMenuDescriptions.menuId, menuIds), eq(qrMenuDescriptions.localeCode, "ko")));
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ER_BAD_FIELD_ERROR") {
      const rows = await db.select({ menuId: qrMenuDescriptions.menuId, shortDescription: qrMenuDescriptions.shortDescription,
        detailDescription: qrMenuDescriptions.detailDescription })
        .from(qrMenuDescriptions).where(and(inArray(qrMenuDescriptions.menuId, menuIds), eq(qrMenuDescriptions.localeCode, "ko")));
      return rows.map(row => ({ ...row, originDescription: null }));
    }
    if (code !== "ER_NO_SUCH_TABLE" && code !== "ER_TABLEACCESS_DENIED_ERROR") throw error;
    if (!missingQrMenuDescriptionSchemaLogged) {
      console.warn("QR menu short descriptions unavailable", { code });
      missingQrMenuDescriptionSchemaLogged = true;
    }
    return [];
  }
}

async function loadKoreanOrigins(menuIds: number[]) {
  try {
    return await db.select({ menuId: qrMenuOriginItems.menuId, ingredientName: qrMenuOriginTranslations.ingredientName, originText: qrMenuOriginTranslations.originText, sortOrder: qrMenuOriginItems.sortOrder, originId: qrMenuOriginItems.originId })
      .from(qrMenuOriginItems).innerJoin(qrMenuOriginTranslations, and(eq(qrMenuOriginTranslations.originId, qrMenuOriginItems.originId), eq(qrMenuOriginTranslations.localeCode, "ko")))
      .where(inArray(qrMenuOriginItems.menuId, menuIds)).orderBy(qrMenuOriginItems.menuId, qrMenuOriginItems.sortOrder, qrMenuOriginItems.originId);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "ER_NO_SUCH_TABLE" && code !== "ER_TABLEACCESS_DENIED_ERROR") throw error;
    if (!missingQrMenuDescriptionSchemaLogged) {
      console.warn("QR menu origin data unavailable", { code });
      missingQrMenuDescriptionSchemaLogged = true;
    }
    return [];
  }
}

/** Customer-safe projection of the live menu catalog; never includes KDS or recipe data. */
export async function loadQrMenuCatalog({ includeShortDescriptions = false }: { includeShortDescriptions?: boolean } = {}) {
  const [categoryRows, menuRows] = await Promise.all([
    db.select({ categoryId: menuCategories.categoryId, name: menuCategories.posName, tabColor: menuCategories.tabColor })
      .from(menuCategories).where(eq(menuCategories.isActive, 1))
      .orderBy(menuCategories.sortOrder, menuCategories.categoryId),
    db.select({ menuId: menus.menuId, categoryId: menus.categoryId, categoryName: menuCategories.posName, name: menus.posName, price: menus.price })
      .from(menus).innerJoin(menuCategories, and(eq(menus.categoryId, menuCategories.categoryId), eq(menuCategories.isActive, 1)))
      .where(and(eq(menus.isActive, 1), eq(menus.isQrVisible, 1)))
      .orderBy(menuCategories.sortOrder, menus.sortOrder, menus.menuId),
  ]);
  const visibleCategoryIds = [...new Set(menuRows.map(menu => menu.categoryId).filter((id): id is number => id !== null))];
  const categories = categoryRows.filter(category => visibleCategoryIds.includes(category.categoryId));
  if (!menuRows.length) return { categories, menus: [], modifierGroups: [] };

  const menuIds = menuRows.map(menu => menu.menuId);
  const addonMenu = alias(menus, "qr_addon_menu");
  const descriptionsPromise = includeShortDescriptions ? loadKoreanDescriptions(menuIds) : Promise.resolve([]);
  const [imageRows, modifierRows, descriptionRows, originRows] = await Promise.all([
    db.select({ menuId: menuImages.menuId, imageType: menuImages.imageType, imageUrl: menuImages.imageUrl, sortOrder: menuImages.sortOrder })
      .from(menuImages).where(and(inArray(menuImages.menuId, menuIds), inArray(menuImages.imageType, ["QR_THUMBNAIL", "QR_LARGE"]), eq(menuImages.isActive, 1)))
      .orderBy(menuImages.sortOrder, menuImages.menuImageId),
    db.select({ menuId: menuModifierGroups.menuId, modifierGroupId: modifierGroups.modifierGroupId,
      name: modifierGroups.posName, minSelect: modifierGroups.minSelect, maxSelect: modifierGroups.maxSelect,
      isRequired: modifierGroups.isRequired, groupSortOrder: menuModifierGroups.sortOrder,
      defaultOptionId: menuModifierGroups.posChoiceDefaultOptionId, modifierOptionId: modifierOptions.modifierOptionId,
      optionName: modifierOptions.posName, qrDescription: modifierOptions.qrDescription, priceDelta: modifierOptions.priceDelta,
      optionSortOrder: modifierOptions.sortOrder, linkedMenuId: modifierOptions.linkedMenuId,
      addonMenuName: addonMenu.posName, addonMenuPrice: addonMenu.price, addonMenuQrVisible: addonMenu.isQrVisible })
      .from(menuModifierGroups)
      .innerJoin(menus, and(eq(menus.menuId, menuModifierGroups.menuId), eq(menus.isActive, 1), eq(menus.isQrVisible, 1)))
      .innerJoin(modifierGroups, and(eq(modifierGroups.modifierGroupId, menuModifierGroups.modifierGroupId), eq(modifierGroups.isActive, 1)))
      .innerJoin(modifierOptions, and(eq(modifierOptions.modifierGroupId, modifierGroups.modifierGroupId), eq(modifierOptions.isActive, 1)))
      .leftJoin(addonMenu, and(eq(addonMenu.menuId, modifierOptions.linkedMenuId), eq(addonMenu.isActive, 1)))
      .where(and(inArray(menuModifierGroups.menuId, menuIds), ne(modifierGroups.posName, QR_LEGACY_AUTO_ADDON_GROUP_NAME)))
      .orderBy(menuModifierGroups.menuId, menuModifierGroups.sortOrder, modifierGroups.sortOrder, modifierOptions.sortOrder, modifierOptions.modifierOptionId),
    descriptionsPromise,
    includeShortDescriptions ? loadKoreanOrigins(menuIds) : Promise.resolve([]),
  ]);

  const imagesByMenu = new Map<number, typeof imageRows>();
  for (const image of imageRows) imagesByMenu.set(image.menuId, [...(imagesByMenu.get(image.menuId) ?? []), image]);
  const modifiersByMenu = new Map<number, typeof modifierRows>();
  for (const row of modifierRows) modifiersByMenu.set(row.menuId, [...(modifiersByMenu.get(row.menuId) ?? []), row]);
  const descriptionsByMenu = new Map(descriptionRows.map(row => [row.menuId, row.shortDescription]));
  const detailByMenu = new Map(descriptionRows.map(row => [row.menuId, row.detailDescription.trim()]));
  const originDescriptionByMenu = new Map(descriptionRows.map(row => [row.menuId, row.originDescription]));
  const originsByMenu = new Map<number, Array<{ ingredientName: string; originText: string }>>();
  const emittedAddonLinks = new Set<string>();
  const emittedAddonDisplayLinks = new Set<string>();
  for (const row of originRows) originsByMenu.set(row.menuId, [...(originsByMenu.get(row.menuId) ?? []), { ingredientName: row.ingredientName, originText: row.originText }]);
  const addonDisplayEntriesByMenu = new Map<number, QrMenuAddonDisplayEntry[]>();
  for (const row of modifierRows) {
    if (!isQrMenuAddonGroupForMenu(row.name, row.menuId)) continue;
    if (row.linkedMenuId === null) {
      const type = qrMenuAddonMarkerType(row.optionName);
      if (type) addonDisplayEntriesByMenu.set(row.menuId, [
        ...(addonDisplayEntriesByMenu.get(row.menuId) ?? []), { type, entryId: row.modifierOptionId },
      ]);
      continue;
    }
    const relationKey = `${row.menuId}:${row.modifierGroupId}:${row.linkedMenuId}`;
    if (!row.addonMenuName || row.addonMenuPrice === null || emittedAddonDisplayLinks.has(relationKey)) continue;
    emittedAddonDisplayLinks.add(relationKey);
    addonDisplayEntriesByMenu.set(row.menuId, [
      ...(addonDisplayEntriesByMenu.get(row.menuId) ?? []),
      { type: "menu", entryId: row.modifierOptionId, menuId: row.linkedMenuId, name: row.addonMenuName,
        price: row.addonMenuPrice, isQrVisible: Boolean(row.addonMenuQrVisible) },
    ]);
  }
  const qrMenus = menuRows.map(menu => {
    const menuImages = imagesByMenu.get(menu.menuId) ?? [];
    const image = menuImages.find(candidate => candidate.imageType === "QR_THUMBNAIL") ?? null;
    const detailImages = menuImages.filter(candidate => candidate.imageType === "QR_LARGE").map(candidate => candidate.imageUrl);
    return { ...menu, imageUrl: image?.imageUrl ?? null, addonDisplayEntries: addonDisplayEntriesByMenu.get(menu.menuId) ?? [],
      ...(includeShortDescriptions ? { shortDescription: descriptionsByMenu.get(menu.menuId) ?? null,
        detailDescription: detailByMenu.get(menu.menuId) ?? null, detailImages,
        originDescription: originDescriptionByMenu.get(menu.menuId)
          ?? (originsByMenu.get(menu.menuId) ?? []).map(origin => `${origin.ingredientName}: ${origin.originText}`).join("\n") } : {}) };
  });
  const qrMenuIds = new Set(qrMenus.map(menu => menu.menuId));
  const cartOnlyAddonMenus = new Map<number, { menuId: number; name: string; price: string }>();
  for (const row of modifierRows) {
    if (!isQrMenuAddonGroupForMenu(row.name, row.menuId) || !row.linkedMenuId || !row.addonMenuName ||
      row.addonMenuPrice === null || qrMenuIds.has(row.linkedMenuId)) continue;
    cartOnlyAddonMenus.set(row.linkedMenuId, { menuId: row.linkedMenuId, name: row.addonMenuName, price: row.addonMenuPrice });
  }
  return {
    categories,
    menus: [...qrMenus, ...[...cartOnlyAddonMenus.values()].map(menu => ({ ...menu, categoryId: null,
      categoryName: undefined, imageUrl: null, qrCartOnly: true, addonDisplayEntries: [] as QrMenuAddonDisplayEntry[] }))],
    modifierGroups: modifierRows.flatMap(({ menuId, modifierGroupId, name, minSelect, maxSelect, isRequired,
      groupSortOrder, defaultOptionId, modifierOptionId, optionName, qrDescription, priceDelta, optionSortOrder,
      linkedMenuId, addonMenuName, addonMenuPrice }) => {
      const isAddon = isQrMenuAddonGroupName(name);
      const source = qrModifierSource(name);
      if (!source) return [];
      if (isAddon && !isQrMenuAddonGroupForMenu(name, menuId)) return [];
      if (isAddon && (!linkedMenuId || !addonMenuName || addonMenuPrice === null)) return [];
      if (isAddon) {
        const relationKey = `${menuId}:${modifierGroupId}:${linkedMenuId}`;
        if (emittedAddonLinks.has(relationKey)) return [];
        emittedAddonLinks.add(relationKey);
      }
      return [{ menuId, modifierGroupId, name: isAddon ? QR_MENU_ADDON_GROUP_TITLE : name,
        minSelect, maxSelect: isAddon ? Math.min(maxSelect, 4) : maxSelect, isRequired: Boolean(isRequired), groupSortOrder,
        defaultOptionId, modifierOptionId, optionName: isAddon ? addonMenuName! : optionName,
        qrDescription, priceDelta: isAddon ? addonMenuPrice! : priceDelta, optionSortOrder, source,
        linkedMenuId: isAddon ? linkedMenuId : null }];
    }),
  };
}
