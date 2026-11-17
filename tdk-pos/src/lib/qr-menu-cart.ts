import type { QrMenuAddonDisplayEntry } from "@/lib/qr-menu-addon-model";

export type QrLocale = "ko" | "en" | "zh-CN" | "ja";
export type QrOption = { modifierOptionId: number; optionName: string; qrDescription?: string; priceDelta: string; optionSortOrder: number };
export type QrModifierGroup = { modifierGroupId: number; name: string; minSelect: number; maxSelect: number;
  isRequired: boolean; defaultOptionId: number | null; source: "MENU_ADDON" | "OPTION"; options: QrOption[] };
export type QrMenu = { menuId: number; categoryId: number | null; categoryName?: string; name: string; price: string; imageUrl: string | null; qrCartOnly?: boolean; detailImages?: string[]; detailDescription?: string | null; originDescription?: string | null; shortDescription?: string | null; addonDisplayEntries?: QrMenuAddonDisplayEntry[]; groups: QrModifierGroup[] };
export type QrCartOption = { modifierOptionId: number; qty: number };
export type QrCartLine = { menuId: number; qty: number; options: QrCartOption[] };
export type QrCatalog = { categories: Array<{ categoryId: number; name: string; tabColor: string | null }>; menus: QrMenu[] };

export function formatQrCartPrice(value: number): string {
  const amount = Number.isFinite(value) ? Math.round(value) : 0;
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(amount)}원`;
}

export function isQrSpiceGroupName(name: string) {
  const normalized = name.trim().replace(/\s+/g, "");
  return normalized === "매운맛" || normalized === "맵기선택";
}

export function qrMenuAddonGroups(groups: QrModifierGroup[]) {
  return groups.filter(group => group.source === "MENU_ADDON");
}

export function qrOtherOptionalGroups(groups: QrModifierGroup[]) {
  return groups.filter(group => group.source === "OPTION" && !isQrSpiceGroupName(group.name) && !group.isRequired && group.minSelect === 0);
}

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
  maxSelect: number; isRequired: boolean; defaultOptionId: number | null; modifierOptionId: number; optionName: string; qrDescription?: string | null;
  priceDelta: string; groupSortOrder: number; optionSortOrder: number; source?: "MENU_ADDON" | "OPTION" }>, menuId: number): QrModifierGroup[] {
  const groups = new Map<number, QrModifierGroup & { groupSortOrder: number }>();
  for (const row of rows) {
    if (row.menuId !== menuId) continue;
    const group = groups.get(row.modifierGroupId) ?? { modifierGroupId: row.modifierGroupId, name: row.name,
      minSelect: row.minSelect, maxSelect: row.maxSelect, isRequired: row.isRequired,
      defaultOptionId: row.defaultOptionId, source: row.source ?? "OPTION", options: [], groupSortOrder: row.groupSortOrder };
    group.options.push({ modifierOptionId: row.modifierOptionId, optionName: row.optionName, qrDescription: row.qrDescription ?? "",
      priceDelta: row.priceDelta, optionSortOrder: row.optionSortOrder });
    groups.set(row.modifierGroupId, group);
  }
  return [...groups.values()].sort((a, b) => a.groupSortOrder - b.groupSortOrder || a.modifierGroupId - b.modifierGroupId)
    .map(group => ({
      modifierGroupId: group.modifierGroupId, name: group.name, minSelect: group.minSelect, maxSelect: group.maxSelect,
      isRequired: group.isRequired, defaultOptionId: group.defaultOptionId, source: group.source,
      options: group.options.sort((a, b) => a.optionSortOrder - b.optionSortOrder || a.modifierOptionId - b.modifierOptionId),
    }));
}

export function defaultQrSelections(groups: QrModifierGroup[]): Record<number, number[]> {
  return Object.fromEntries(groups.map(group => {
    const selected = group.options.find(option => option.modifierOptionId === group.defaultOptionId) ??
      (isQrSpiceGroupName(group.name) ? group.options.find(option => /^\s*2\s*[.)]\s*약간매운맛\s*$/.test(option.optionName)) : undefined);
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
      (group.source === "MENU_ADDON" ? selected.length <= group.options.length : selected.length <= Math.max(0, group.maxSelect)) &&
      selected.every(id => group.options.some(option => option.modifierOptionId === id));
  }) && Object.entries(selections).every(([groupId, selected]) =>
    groups.some(group => group.modifierGroupId === Number(groupId)) || selected.length === 0);
}

export function selectedQrOptions(groups: QrModifierGroup[], selections: Record<number, number[]>, addonQuantities: Record<number, number> = {}): QrCartOption[] {
  return groups.flatMap(group => (selections[group.modifierGroupId] ?? []).map(modifierOptionId => ({
    modifierOptionId, qty: group.source === "MENU_ADDON" ? addonQuantities[modifierOptionId] ?? 1 : 1,
  })))
    .sort((a, b) => a.modifierOptionId - b.modifierOptionId);
}

/** Build a one-item quick-add line from configured defaults, or return null when the customer must choose. */
export function qrImmediateAddLine(menu: QrMenu, defaults: Record<number, number[]>): QrCartLine | null {
  const selections = Object.fromEntries(menu.groups.map(group => [group.modifierGroupId,
    group.source === "MENU_ADDON" ? [] : defaults[group.modifierGroupId] ?? [],
  ]));
  if (!validQrSelections(menu.groups, selections)) return null;
  return {
    menuId: menu.menuId,
    qty: 1,
    options: selectedQrOptions(menu.groups, selections).filter(selected =>
      menu.groups.some(group => group.source !== "MENU_ADDON" && group.options.some(option => option.modifierOptionId === selected.modifierOptionId))),
  };
}

export function qrLineUnitPrice(menu: QrMenu, options: QrCartOption[]): number {
  const optionPrice = options.reduce((sum, selected) => {
    for (const group of menu.groups) {
      if (group.source === "MENU_ADDON") continue;
      const option = group.options.find(candidate => candidate.modifierOptionId === selected.modifierOptionId);
      if (option) return sum + Number(option.priceDelta) * selected.qty;
    }
    return sum;
  }, 0);
  return Math.max(0, Number(menu.price) + optionPrice);
}

/** Add-on menu quantities are independent of the base menu quantity. */
export function qrLineTotal(menu: QrMenu, options: QrCartOption[], baseQty: number): number {
  const addonTotal = options.reduce((sum, selected) => {
    const group = menu.groups.find(candidate => candidate.source === "MENU_ADDON" &&
      candidate.options.some(option => option.modifierOptionId === selected.modifierOptionId));
    const option = group?.options.find(candidate => candidate.modifierOptionId === selected.modifierOptionId);
    return sum + (option ? Number(option.priceDelta) * selected.qty : 0);
  }, 0);
  return qrLineUnitPrice(menu, options) * baseQty + addonTotal;
}

export function qrLineItemCount(menu: QrMenu, baseQty: number, options: QrCartOption[]): number {
  return baseQty + options.reduce((sum, selected) => {
    const isAddon = menu.groups.some(group => group.source === "MENU_ADDON" &&
      group.options.some(option => option.modifierOptionId === selected.modifierOptionId));
    return sum + (isAddon ? selected.qty : 0);
  }, 0);
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
      const optionGroup = menu.groups.find(group => group.options.some(option => option.modifierOptionId === optionId));
      if (!Number.isSafeInteger(optionId) || optionIds.has(optionId) || !optionGroup ||
        (optionGroup.source === "MENU_ADDON" ? !Number.isInteger(optionQty) || optionQty < 1 || optionQty > 99 : optionQty !== 1)) {
        invalidOption = true;
        break;
      }
      optionIds.add(optionId);
      options.push({ modifierOptionId: optionId, qty: optionQty });
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

export function addQrCartLine(lines: QrCartLine[], line: QrCartLine, menu?: QrMenu): QrCartLine[] {
  const isAddon = (optionId: number) => Boolean(menu?.groups.some(group => group.source === "MENU_ADDON" &&
    group.options.some(option => option.modifierOptionId === optionId)));
  const signature = (item: QrCartLine) => JSON.stringify(item.options.map(option => [
    option.modifierOptionId, isAddon(option.modifierOptionId) ? null : option.qty,
  ]));
  const existing = lines.find(item => item.menuId === line.menuId && signature(item) === signature(line));
  if (!existing) return [...lines, line];
  return lines.map(item => item === existing ? {
    ...item,
    qty: Math.min(99, item.qty + line.qty),
    options: item.options.map(option => isAddon(option.modifierOptionId) ? {
      ...option,
      qty: Math.min(99, option.qty + (line.options.find(candidate => candidate.modifierOptionId === option.modifierOptionId)?.qty ?? 0)),
    } : option),
  } : item);
}

/** Convert older bundled add-on selections into standalone sale-menu cart lines. */
export function splitQrCartAddonLines(lines: QrCartLine[], catalog: QrCatalog): QrCartLine[] {
  return lines.reduce<QrCartLine[]>((result, line) => {
    const parent = catalog.menus.find(menu => menu.menuId === line.menuId);
    if (!parent) return result;
    const baseOptions: QrCartOption[] = [];
    const addonLines: QrCartLine[] = [];
    for (const selected of line.options) {
      const group = parent.groups.find(candidate => candidate.source === "MENU_ADDON" &&
        candidate.options.some(option => option.modifierOptionId === selected.modifierOptionId));
      if (!group) {
        baseOptions.push(selected);
        continue;
      }
      const displayEntry = parent.addonDisplayEntries?.find(entry => entry.entryId === selected.modifierOptionId);
      const addonMenu = displayEntry?.type === "menu"
        ? catalog.menus.find(menu => menu.menuId === displayEntry.menuId)
        : undefined;
      if (!addonMenu) {
        // Keep older cart data intact if the linked menu has since been removed.
        baseOptions.push(selected);
        continue;
      }
      addonLines.push({ menuId: addonMenu.menuId, qty: selected.qty, options: [] });
    }
    let next = addQrCartLine(result, { menuId: line.menuId, qty: line.qty, options: baseOptions }, parent);
    for (const addonLine of addonLines) {
      const addonMenu = catalog.menus.find(menu => menu.menuId === addonLine.menuId);
      next = addQrCartLine(next, addonLine, addonMenu);
    }
    return next;
  }, []);
}

export function qrCartTotal(lines: QrCartLine[], menus: QrMenu[]): number {
  return lines.reduce((sum, line) => {
    const menu = menus.find(item => item.menuId === line.menuId);
    return menu ? sum + qrLineTotal(menu, line.options, line.qty) : sum;
  }, 0);
}
