export const QR_MENU_ADDON_GROUP_PREFIX = "__TDKON_QR_ADDON__:";
export const QR_MENU_ADDON_GROUP_TITLE = "메뉴별 추가";
export const QR_MENU_ADDON_MAX_SELECTIONS = 4;
export const QR_MENU_ADDON_OPTION_LABEL = "QR 메뉴 추가";
export const QR_LEGACY_AUTO_ADDON_GROUP_NAME = "추가메뉴";

export const QR_MENU_ADDON_DIVIDER_MARKER = "__TDKON_QR_ADDON_DIVIDER__";
export const QR_MENU_ADDON_SPACER_MARKER = "__TDKON_QR_ADDON_SPACER__";

export type QrMenuAddonEntryInput =
  | { type: "menu"; menuId: number }
  | { type: "divider" }
  | { type: "spacer" };

export type QrMenuAddonDisplayEntry =
  | { type: "menu"; entryId: number; menuId: number; name: string; price: string; isQrVisible: boolean }
  | { type: "divider"; entryId: number }
  | { type: "spacer"; entryId: number };

export function qrMenuAddonMarkerType(optionName: string): "divider" | "spacer" | null {
  if (optionName === QR_MENU_ADDON_DIVIDER_MARKER) return "divider";
  if (optionName === QR_MENU_ADDON_SPACER_MARKER) return "spacer";
  return null;
}

export function qrMenuAddonMarkerName(type: "divider" | "spacer") {
  return type === "divider" ? QR_MENU_ADDON_DIVIDER_MARKER : QR_MENU_ADDON_SPACER_MARKER;
}
export type QrModifierSource = "MENU_ADDON" | "OPTION";

export function qrModifierSource(name: string): QrModifierSource | null {
  if (isQrMenuAddonGroupName(name)) return "MENU_ADDON";
  if (name === QR_LEGACY_AUTO_ADDON_GROUP_NAME) return null;
  return "OPTION";
}

export function qrMenuAddonGroupName(menuId: number) {
  return `${QR_MENU_ADDON_GROUP_PREFIX}${menuId}`;
}

export function isQrMenuAddonGroupForMenu(name: string, menuId: number) {
  return name === qrMenuAddonGroupName(menuId);
}

export function isQrMenuAddonGroupName(name: string) {
  return name.startsWith(QR_MENU_ADDON_GROUP_PREFIX) && /^\d+$/.test(name.slice(QR_MENU_ADDON_GROUP_PREFIX.length));
}

export function normalizeQrMenuAddonIds(value: unknown, baseMenuId: number): number[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const candidate of value) {
    if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate <= 0 || candidate === baseMenuId || seen.has(candidate)) return null;
    const menuId = candidate;
    seen.add(menuId);
    ids.push(menuId);
  }
  return ids;
}
export function normalizeQrMenuAddonEntries(value: unknown, baseMenuId: number): QrMenuAddonEntryInput[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const entries: QrMenuAddonEntryInput[] = [];
  const seenMenuIds = new Set<number>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const entry = candidate as Record<string, unknown>;
    if (entry.type === "divider" || entry.type === "spacer") {
      entries.push({ type: entry.type });
      continue;
    }
    if (entry.type !== "menu" || typeof entry.menuId !== "number" || !Number.isSafeInteger(entry.menuId) ||
      entry.menuId <= 0 || entry.menuId === baseMenuId || seenMenuIds.has(entry.menuId)) return null;
    seenMenuIds.add(entry.menuId);
    entries.push({ type: "menu", menuId: entry.menuId });
  }
  return entries;
}
