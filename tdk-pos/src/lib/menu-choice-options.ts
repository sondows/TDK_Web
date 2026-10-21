import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { menuModifierGroups, modifierGroups, modifierOptions } from "@/db/schema";

export type MenuChoiceConfig = { enabled: boolean; title: string; buttons: string[]; defaultIndex: number };
type MenuTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function parseMenuChoiceConfig(value: unknown): MenuChoiceConfig | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.enabled !== "boolean") return null;
  if (!input.enabled) return { enabled: false, title: "", buttons: [], defaultIndex: 0 };
  if (typeof input.title !== "string" || !Array.isArray(input.buttons) || !Number.isInteger(input.defaultIndex)) return null;
  const title = input.title.trim();
  const buttons = input.buttons.map(button => typeof button === "string" ? button.trim() : "");
  const defaultIndex = Number(input.defaultIndex);
  if (title.length > 150 || buttons.length < 2 || buttons.length > 4 || buttons.some(button => !button || button.length > 150) || defaultIndex < 0 || defaultIndex >= buttons.length) return null;
  return { enabled: true, title, buttons, defaultIndex };
}

export async function loadMenuChoiceConfigs() {
  const rows = await db.select({ menuId: menuModifierGroups.menuId, groupId: modifierGroups.modifierGroupId, title: modifierGroups.posName, defaultOptionId: menuModifierGroups.posChoiceDefaultOptionId, optionId: modifierOptions.modifierOptionId, optionName: modifierOptions.posName, optionSortOrder: modifierOptions.sortOrder })
    .from(menuModifierGroups)
    .innerJoin(modifierGroups, and(eq(modifierGroups.modifierGroupId, menuModifierGroups.modifierGroupId), eq(modifierGroups.isActive, 1)))
    .innerJoin(modifierOptions, and(eq(modifierOptions.modifierGroupId, modifierGroups.modifierGroupId), eq(modifierOptions.isActive, 1)))
    .orderBy(menuModifierGroups.menuId, menuModifierGroups.sortOrder, modifierOptions.sortOrder, modifierOptions.modifierOptionId);
  const result = new Map<number, MenuChoiceConfig>();
  for (const row of rows) {
    if (row.defaultOptionId === null && row.title !== "매운맛") continue;
    const groupRows = rows.filter(item => item.menuId === row.menuId && item.groupId === row.groupId);
    if (result.has(row.menuId) || !groupRows.length) continue;
    const buttons = groupRows.map(item => item.optionName);
    const defaultIndex = Math.max(0, groupRows.findIndex(item => item.optionId === row.defaultOptionId || (row.defaultOptionId === null && item.optionName === "약간매운맛")));
    result.set(row.menuId, { enabled: true, title: row.title, buttons, defaultIndex });
  }
  return result;
}

export async function saveMenuChoiceConfig(tx: MenuTransaction, menuId: number, config: MenuChoiceConfig) {
  const links = await tx.select({ groupId: menuModifierGroups.modifierGroupId, defaultOptionId: menuModifierGroups.posChoiceDefaultOptionId, groupName: modifierGroups.posName })
    .from(menuModifierGroups).innerJoin(modifierGroups, eq(modifierGroups.modifierGroupId, menuModifierGroups.modifierGroupId))
    .where(eq(menuModifierGroups.menuId, menuId)).for("update");
  const existing = links.find(link => link.defaultOptionId !== null) ?? links.find(link => link.groupName === "매운맛");
  if (!config.enabled) {
    if (existing) await tx.delete(menuModifierGroups).where(and(eq(menuModifierGroups.menuId, menuId), eq(menuModifierGroups.modifierGroupId, existing.groupId)));
    return;
  }
  // Legacy groups can be shared by multiple menus. Give this menu its own group.
  const managedGroupId = existing?.defaultOptionId !== null ? existing?.groupId : undefined;
  let groupId = managedGroupId;
  if (groupId === undefined) {
    const inserted = await tx.insert(modifierGroups).values({ posName: config.title, minSelect: 1, maxSelect: 1, isRequired: 1, isActive: 1, sortOrder: 0 });
    groupId = Number(inserted[0].insertId);
  } else {
    await tx.update(modifierGroups).set({ posName: config.title }).where(eq(modifierGroups.modifierGroupId, groupId));
  }
  const oldOptions = managedGroupId === undefined ? [] : await tx.select({ optionId: modifierOptions.modifierOptionId }).from(modifierOptions)
    .where(and(eq(modifierOptions.modifierGroupId, groupId), eq(modifierOptions.isActive, 1)))
    .orderBy(modifierOptions.sortOrder, modifierOptions.modifierOptionId).for("update");
  const optionIds: number[] = [];
  for (const [index, label] of config.buttons.entries()) {
    const existingOption = oldOptions[index];
    if (existingOption) {
      await tx.update(modifierOptions).set({ posName: label, sortOrder: (index + 1) * 10 }).where(eq(modifierOptions.modifierOptionId, existingOption.optionId));
      optionIds.push(existingOption.optionId);
    } else {
      const inserted = await tx.insert(modifierOptions).values({ modifierGroupId: groupId, posName: label, priceDelta: "0.00", sortOrder: (index + 1) * 10, isActive: 1 });
      optionIds.push(Number(inserted[0].insertId));
    }
  }
  for (const old of oldOptions.slice(config.buttons.length)) await tx.update(modifierOptions).set({ isActive: 0 }).where(eq(modifierOptions.modifierOptionId, old.optionId));
  if (existing && existing.groupId !== groupId) await tx.delete(menuModifierGroups).where(and(eq(menuModifierGroups.menuId, menuId), eq(menuModifierGroups.modifierGroupId, existing.groupId)));
  if (managedGroupId === undefined) await tx.insert(menuModifierGroups).values({ menuId, modifierGroupId: groupId, sortOrder: 0, posChoiceDefaultOptionId: optionIds[config.defaultIndex] });
  else await tx.update(menuModifierGroups).set({ posChoiceDefaultOptionId: optionIds[config.defaultIndex] }).where(and(eq(menuModifierGroups.menuId, menuId), eq(menuModifierGroups.modifierGroupId, groupId)));
}
