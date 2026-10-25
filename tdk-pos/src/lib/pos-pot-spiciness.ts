import { getMenuChoice, type MenuChoiceModifier } from "./menu-choice-selection";

type PotMenu = { menuId: number; kdsKind: string; kdsGroupKey: string | null };
type ChoiceModifier = MenuChoiceModifier & { menuId: number; priceDelta: string };
type CartOption = { modifierGroupId: number; modifierOptionId: number; optionName: string; priceDelta: number; qty: number };
type CartItem = { menuId: number; unitPrice: number; options?: CartOption[] };

/** The KDS groups POT menus in the same submitted order by this key. */
export function posPotKey(menu: PotMenu | undefined) {
  return menu?.kdsKind === "POT" ? menu.kdsGroupKey?.trim() || "POT" : null;
}

export function spicyChoiceKey(name: string) {
  const stage = /^\s*(\d+)\s*[.번)]/.exec(name);
  return stage ? `stage:${Number(stage[1])}` : `name:${name.trim()}`;
}

export function hasConsistentPotSpiciness(rows: Array<{ potKey: string; optionName: string | null }>) {
  const tastes = new Map<string, string | null>();
  for (const row of rows) {
    const taste = row.optionName === null ? null : spicyChoiceKey(row.optionName);
    if (tastes.has(row.potKey) && tastes.get(row.potKey) !== taste) return false;
    tastes.set(row.potKey, taste);
  }
  return true;
}

function spicyChoices(menuId: number, modifiers: ChoiceModifier[]) {
  const choice = getMenuChoice(modifiers.filter(modifier => modifier.menuId === menuId));
  return choice.title === "매운맛" || choice.options.some(option => /^\s*\d+\s*[.번)]/.test(option.optionName))
    ? choice.options : [];
}

function matchingChoice(menuId: number, optionName: string, modifiers: ChoiceModifier[]) {
  const key = spicyChoiceKey(optionName);
  return spicyChoices(menuId, modifiers).find(option => spicyChoiceKey(option.optionName) === key);
}

export function inheritedPotSpicyChoice<T extends PotMenu>(menu: T, cart: CartItem[], menus: T[], modifiers: ChoiceModifier[]) {
  const key = posPotKey(menu);
  if (key === null) return null;
  for (const item of cart) {
    const source = menus.find(candidate => candidate.menuId === item.menuId);
    if (posPotKey(source) !== key) continue;
    const sourceChoices = spicyChoices(item.menuId, modifiers);
    const selected = item.options?.find(option => sourceChoices.some(choice => choice.modifierOptionId === option.modifierOptionId));
    if (selected) return matchingChoice(menu.menuId, selected.optionName, modifiers) ?? null;
  }
  return null;
}

/** Update only the taste option of other menus in the same pending KDS pot. */
export function synchronizePendingPotSpiciness<T extends CartItem, M extends PotMenu>(
  cart: T[], menu: M, selectedOptionName: string, menus: M[], modifiers: ChoiceModifier[],
): T[] {
  const key = posPotKey(menu);
  if (key === null || !matchingChoice(menu.menuId, selectedOptionName, modifiers)) return cart;
  return cart.map(item => {
    if (posPotKey(menus.find(candidate => candidate.menuId === item.menuId)) !== key) return item;
    const selected = matchingChoice(item.menuId, selectedOptionName, modifiers);
    if (!selected) return item;
    const choices = spicyChoices(item.menuId, modifiers);
    const old = item.options?.find(option => choices.some(choice => choice.modifierOptionId === option.modifierOptionId));
    const next: CartOption = {
      modifierGroupId: selected.modifierGroupId, modifierOptionId: selected.modifierOptionId,
      optionName: selected.optionName, priceDelta: Number(selected.priceDelta), qty: old?.qty ?? 1,
    };
    return {
      ...item,
      unitPrice: item.unitPrice - (old?.priceDelta ?? 0) * (old?.qty ?? 1) + next.priceDelta * next.qty,
      options: old ? item.options!.map(option => option === old ? next : option) : [...(item.options ?? []), next],
    };
  });
}
