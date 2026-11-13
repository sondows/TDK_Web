export type QrLocale = "ko" | "en" | "zh-CN" | "ja";
export type QrOption = { modifierOptionId: number; optionName: string; priceDelta: string; optionSortOrder: number };
export type QrModifierGroup = { modifierGroupId: number; name: string; minSelect: number; maxSelect: number;
  isRequired: boolean; defaultOptionId: number | null; options: QrOption[] };
export type QrMenu = { menuId: number; categoryId: number | null; name: string; price: string; imageUrl: string | null; groups: QrModifierGroup[] };
export type QrCartOption = { modifierOptionId: number; qty: number };
export type QrCartLine = { menuId: number; qty: number; options: QrCartOption[] };
export type QrCatalog = { categories: Array<{ categoryId: number; name: string; tabColor: string | null }>; menus: QrMenu[] };

export function qrMenusForCategory(catalog: QrCatalog | null, categoryId: number | null): QrMenu[] {
  return catalog && categoryId !== null ? catalog.menus.filter(menu => menu.categoryId === categoryId) : [];
}

export const QR_CART_STORAGE_KEY = "tdkon:qr-cart:v1";
export const QR_LOCALE_STORAGE_KEY = "tdkon:qr-locale:v1";
export const QR_SUPPORTED_LOCALES: QrLocale[] = ["ko", "en", "zh-CN", "ja"];

export function qrLocaleFromPreferences(languages: readonly string[]): QrLocale {
  for (const raw of languages) {
    const language = raw.toLowerCase();
    if (language.startsWith("zh")) return "zh-CN";
    if (language.startsWith("ja")) return "ja";
    if (language.startsWith("en")) return "en";
    if (language.startsWith("ko")) return "ko";
  }
  return "ko";
}

export function groupQrModifiers(rows: Array<{ menuId: number; modifierGroupId: number; name: string; minSelect: number;
  maxSelect: number; isRequired: boolean; defaultOptionId: number | null; modifierOptionId: number; optionName: string;
  priceDelta: string; groupSortOrder: number; optionSortOrder: number }>, menuId: number): QrModifierGroup[] {
  const groups = new Map<number, QrModifierGroup & { groupSortOrder: number }>();
  for (const row of rows) {
    if (row.menuId !== menuId) continue;
    const group = groups.get(row.modifierGroupId) ?? { modifierGroupId: row.modifierGroupId, name: row.name,
      minSelect: row.minSelect, maxSelect: row.maxSelect, isRequired: row.isRequired,
      defaultOptionId: row.defaultOptionId, options: [], groupSortOrder: row.groupSortOrder };
    group.options.push({ modifierOptionId: row.modifierOptionId, optionName: row.optionName,
      priceDelta: row.priceDelta, optionSortOrder: row.optionSortOrder });
    groups.set(row.modifierGroupId, group);
  }
  return [...groups.values()].sort((a, b) => a.groupSortOrder - b.groupSortOrder || a.modifierGroupId - b.modifierGroupId)
    .map(group => ({
      modifierGroupId: group.modifierGroupId, name: group.name, minSelect: group.minSelect, maxSelect: group.maxSelect,
      isRequired: group.isRequired, defaultOptionId: group.defaultOptionId,
      options: group.options.sort((a, b) => a.optionSortOrder - b.optionSortOrder || a.modifierOptionId - b.modifierOptionId),
    }));
}

export function defaultQrSelections(groups: QrModifierGroup[]): Record<number, number[]> {
  return Object.fromEntries(groups.map(group => {
    const selected = group.options.find(option => option.modifierOptionId === group.defaultOptionId) ??
      (group.name === "매운맛" ? group.options.find(option => /^\s*2\s*[.)]\s*약간매운맛\s*$/.test(option.optionName)) : undefined);
    const requiredFallback = group.isRequired || group.minSelect > 0
      ? (group.options.length === 1 ? group.options[0] : undefined) : undefined;
    const finalSelection = selected ?? requiredFallback;
    return [group.modifierGroupId, finalSelection ? [finalSelection.modifierOptionId] : []];
  }));
}

export function validQrSelections(groups: QrModifierGroup[], selections: Record<number, number[]>): boolean {
  return groups.every(group => {
    const selected = selections[group.modifierGroupId] ?? [];
    const unique = new Set(selected);
    return unique.size === selected.length && selected.length >= Math.max(group.minSelect, group.isRequired ? 1 : 0) &&
      selected.length <= Math.max(0, group.maxSelect) &&
      selected.every(id => group.options.some(option => option.modifierOptionId === id));
  }) && Object.entries(selections).every(([groupId, selected]) =>
    groups.some(group => group.modifierGroupId === Number(groupId)) || selected.length === 0);
}

export function selectedQrOptions(groups: QrModifierGroup[], selections: Record<number, number[]>): QrCartOption[] {
  return groups.flatMap(group => (selections[group.modifierGroupId] ?? []).map(modifierOptionId => ({ modifierOptionId, qty: 1 })))
    .sort((a, b) => a.modifierOptionId - b.modifierOptionId);
}

export function qrLineUnitPrice(menu: QrMenu, options: QrCartOption[]): number {
  const optionPrice = options.reduce((sum, selected) => {
    for (const group of menu.groups) {
      const option = group.options.find(candidate => candidate.modifierOptionId === selected.modifierOptionId);
      if (option) return sum + Number(option.priceDelta) * selected.qty;
    }
    return sum;
  }, 0);
  return Math.max(0, Number(menu.price) + optionPrice);
}

export function normalizeQrCart(input: unknown, catalog: QrCatalog): QrCartLine[] {
  if (!Array.isArray(input)) return [];
  const lines: QrCartLine[] = [];
  for (const candidate of input) {
    if (!candidate || typeof candidate !== "object") continue;
    const raw = candidate as Partial<QrCartLine>;
    const menu = catalog.menus.find(item => item.menuId === raw.menuId);
    const qty = Number(raw.qty);
    if (!menu || !Number.isInteger(qty) || qty < 1 || qty > 99 || !Array.isArray(raw.options)) continue;
    const optionIds = new Set<number>();
    const options: QrCartOption[] = [];
    let invalidOption = false;
    for (const item of raw.options) {
      const optionId = Number(item?.modifierOptionId), optionQty = Number(item?.qty);
      if (!Number.isSafeInteger(optionId) || optionIds.has(optionId) || optionQty !== 1 ||
        !menu.groups.some(group => group.options.some(option => option.modifierOptionId === optionId))) {
        invalidOption = true;
        break;
      }
      optionIds.add(optionId);
      options.push({ modifierOptionId: optionId, qty: 1 });
    }
    if (invalidOption) continue;
    const selections = Object.fromEntries(menu.groups.map(group => [group.modifierGroupId,
      options.filter(option => group.options.some(candidateOption => candidateOption.modifierOptionId === option.modifierOptionId))
        .map(option => option.modifierOptionId)]));
    if (!validQrSelections(menu.groups, selections)) continue;
    lines.push({ menuId: menu.menuId, qty, options: options.sort((a, b) => a.modifierOptionId - b.modifierOptionId) });
  }
  return lines;
}

export function addQrCartLine(lines: QrCartLine[], line: QrCartLine): QrCartLine[] {
  const signature = (item: QrCartLine) => JSON.stringify(item.options.map(option => [option.modifierOptionId, option.qty]));
  const existing = lines.find(item => item.menuId === line.menuId && signature(item) === signature(line));
  if (!existing) return [...lines, line];
  return lines.map(item => item === existing ? { ...item, qty: Math.min(99, item.qty + line.qty) } : item);
}

export function qrCartTotal(lines: QrCartLine[], menus: QrMenu[]): number {
  return lines.reduce((sum, line) => {
    const menu = menus.find(item => item.menuId === line.menuId);
    return menu ? sum + qrLineUnitPrice(menu, line.options) * line.qty : sum;
  }, 0);
}
