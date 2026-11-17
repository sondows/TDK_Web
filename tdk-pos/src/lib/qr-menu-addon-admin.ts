import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { menuCategories, menuModifierGroups, menus, modifierGroups, modifierOptions } from "@/db/schema";
import {
  QR_MENU_ADDON_MAX_SELECTIONS,
  QR_MENU_ADDON_OPTION_LABEL,
  isQrMenuAddonGroupName,
  qrMenuAddonGroupName,
  qrMenuAddonMarkerName,
  qrMenuAddonMarkerType,
  type QrMenuAddonDisplayEntry,
  type QrMenuAddonEntryInput,
} from "@/lib/qr-menu-addon-model";

export async function readQrMenuAddonAdminData(selectedMenuId?: number) {
  const [menuRows, groups, assignments] = await Promise.all([
    db.select({ menuId: menus.menuId, name: menus.posName, price: menus.price, categoryId: menuCategories.categoryId,
      categoryName: menuCategories.posName, categorySortOrder: menuCategories.sortOrder, sortOrder: menus.sortOrder,
      isActive: menus.isActive, isQrVisible: menus.isQrVisible })
      .from(menus).leftJoin(menuCategories, eq(menuCategories.categoryId, menus.categoryId))
      .orderBy(menuCategories.sortOrder, menuCategories.categoryId, menus.sortOrder, menus.menuId),
    db.select({ modifierGroupId: modifierGroups.modifierGroupId, name: modifierGroups.posName })
      .from(modifierGroups).where(eq(modifierGroups.isActive, 1)),
    db.select({ menuId: menuModifierGroups.menuId, modifierGroupId: menuModifierGroups.modifierGroupId,
      modifierOptionId: modifierOptions.modifierOptionId, optionName: modifierOptions.posName,
      linkedMenuId: modifierOptions.linkedMenuId, optionActive: modifierOptions.isActive, optionSortOrder: modifierOptions.sortOrder,
      addonName: menus.posName, addonPrice: menus.price, addonActive: menus.isActive, addonQrVisible: menus.isQrVisible })
      .from(menuModifierGroups).innerJoin(modifierGroups, eq(modifierGroups.modifierGroupId, menuModifierGroups.modifierGroupId))
      .innerJoin(modifierOptions, eq(modifierOptions.modifierGroupId, modifierGroups.modifierGroupId))
      .leftJoin(menus, eq(menus.menuId, modifierOptions.linkedMenuId)),
  ]);
  const effectiveMenuId = selectedMenuId ?? menuRows[0]?.menuId;
  const groupIds = new Map(groups.filter(group => isQrMenuAddonGroupName(group.name)).map(group => [group.name, group.modifierGroupId]));
  const baseGroupId = effectiveMenuId ? groupIds.get(qrMenuAddonGroupName(effectiveMenuId)) : undefined;
  const seenAddonMenuIds = new Set<number>();
  const entries: QrMenuAddonDisplayEntry[] = baseGroupId ? assignments
    .filter(row => row.menuId === effectiveMenuId && row.modifierGroupId === baseGroupId && row.optionActive === 1)
    .sort((a, b) => a.optionSortOrder - b.optionSortOrder || a.modifierOptionId - b.modifierOptionId)
    .flatMap(row => {
      if (row.linkedMenuId === null) {
        const type = qrMenuAddonMarkerType(row.optionName);
        return type ? [{ type, entryId: row.modifierOptionId } as QrMenuAddonDisplayEntry] : [];
      }
      if (row.addonActive !== 1 || seenAddonMenuIds.has(row.linkedMenuId)) return [];
      seenAddonMenuIds.add(row.linkedMenuId);
      return [{ type: "menu", entryId: row.modifierOptionId, menuId: row.linkedMenuId,
        name: row.addonName ?? "", price: row.addonPrice ?? "0.00", isQrVisible: Boolean(row.addonQrVisible) }];
    }) : [];
  return {
    menus: menuRows.map(row => ({ ...row, categoryName: row.categoryName ?? "카테고리 미지정", isActive: Boolean(row.isActive), isQrVisible: Boolean(row.isQrVisible) })),
    selectedMenuId: effectiveMenuId ?? null,
    entries,
  };
}

export async function readQrMenuAddonEntries(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], baseMenuId: number): Promise<QrMenuAddonEntryInput[]> {
  const rows = await tx.select({ name: modifierGroups.posName, optionName: modifierOptions.posName,
    menuId: modifierOptions.linkedMenuId, active: modifierOptions.isActive, menuActive: menus.isActive,
    sortOrder: modifierOptions.sortOrder, modifierOptionId: modifierOptions.modifierOptionId })
    .from(menuModifierGroups).innerJoin(modifierGroups, eq(modifierGroups.modifierGroupId, menuModifierGroups.modifierGroupId))
    .innerJoin(modifierOptions, eq(modifierOptions.modifierGroupId, modifierGroups.modifierGroupId))
    .leftJoin(menus, eq(menus.menuId, modifierOptions.linkedMenuId))
    .where(eq(menuModifierGroups.menuId, baseMenuId));
  const seen = new Set<number>();
  return rows.filter(row => isQrMenuAddonGroupName(row.name) && row.active === 1)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.modifierOptionId - b.modifierOptionId)
    .flatMap<QrMenuAddonEntryInput>(row => {
      if (row.menuId === null) {
        const type = qrMenuAddonMarkerType(row.optionName);
        return type ? [{ type }] : [];
      }
      if (row.menuActive !== 1 || row.menuId === baseMenuId || seen.has(row.menuId)) return [];
      seen.add(row.menuId);
      return [{ type: "menu" as const, menuId: row.menuId }];
    });
}

export async function saveQrMenuAddons(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], baseMenuId: number, entries: QrMenuAddonEntryInput[]) {
  const [base] = await tx.select({ menuId: menus.menuId }).from(menus).where(eq(menus.menuId, baseMenuId)).for("update");
  if (!base) return false;
  const addonMenuIds = entries.flatMap(entry => entry.type === "menu" ? [entry.menuId] : []);
  const validMenus = addonMenuIds.length ? await tx.select({ menuId: menus.menuId }).from(menus)
    .where(and(inArray(menus.menuId, addonMenuIds), eq(menus.isActive, 1))) : [];
  if (validMenus.length !== addonMenuIds.length) return false;

  const groupName = qrMenuAddonGroupName(baseMenuId);
  const [existingGroup] = await tx.select({ modifierGroupId: modifierGroups.modifierGroupId })
    .from(modifierGroups).where(eq(modifierGroups.posName, groupName)).limit(1).for("update");
  let groupId = existingGroup?.modifierGroupId;
  if (!groupId) {
    const [created] = await tx.insert(modifierGroups).values({ posName: groupName, minSelect: 0,
      maxSelect: QR_MENU_ADDON_MAX_SELECTIONS, isRequired: 0, isActive: 1, sortOrder: 9000 });
    groupId = Number(created.insertId);
  } else {
    await tx.update(modifierGroups).set({ minSelect: 0, maxSelect: QR_MENU_ADDON_MAX_SELECTIONS,
      isRequired: 0, isActive: 1 }).where(eq(modifierGroups.modifierGroupId, groupId));
  }

  const [link] = await tx.select({ menuId: menuModifierGroups.menuId }).from(menuModifierGroups)
    .where(and(eq(menuModifierGroups.menuId, baseMenuId), eq(menuModifierGroups.modifierGroupId, groupId))).limit(1);
  if (!link) await tx.insert(menuModifierGroups).values({ menuId: baseMenuId, modifierGroupId: groupId, sortOrder: 9000, posChoiceDefaultOptionId: null });

  const options = await tx.select({ modifierOptionId: modifierOptions.modifierOptionId,
    linkedMenuId: modifierOptions.linkedMenuId, posName: modifierOptions.posName })
    .from(modifierOptions).where(eq(modifierOptions.modifierGroupId, groupId)).for("update");
  const keptOptionIds = new Set<number>();
  for (const [index, entry] of entries.entries()) {
    const linkedMenuId = entry.type === "menu" ? entry.menuId : null;
    const posName = entry.type === "menu" ? QR_MENU_ADDON_OPTION_LABEL : qrMenuAddonMarkerName(entry.type);
    const existing = options.find(option => !keptOptionIds.has(option.modifierOptionId) &&
      (entry.type === "menu" ? option.linkedMenuId === linkedMenuId : option.linkedMenuId === null && option.posName === posName));
    const values = { posName, priceDelta: "0.00", linkedMenuId, sortOrder: (index + 1) * 10, isActive: 1 };
    if (existing) {
      keptOptionIds.add(existing.modifierOptionId);
      await tx.update(modifierOptions).set(values).where(eq(modifierOptions.modifierOptionId, existing.modifierOptionId));
    } else {
      const [created] = await tx.insert(modifierOptions).values({ modifierGroupId: groupId, ...values });
      keptOptionIds.add(Number(created.insertId));
    }
  }
  const omitIds = options.filter(option => !keptOptionIds.has(option.modifierOptionId)).map(option => option.modifierOptionId);
  if (omitIds.length) await tx.update(modifierOptions).set({ isActive: 0 }).where(inArray(modifierOptions.modifierOptionId, omitIds));
  return true;
}
