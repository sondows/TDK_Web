import "server-only";

import { groupQrModifiers, normalizeQrCart, qrLineTotal, qrLineUnitPrice, type QrCartLine, type QrCatalog } from "@/lib/qr-menu-cart";

/** Keep per-order capability cookies limited to the QR wait-order API namespace. */
export const QR_WAIT_ORDER_COOKIE_PATH = "/api/qr/wait-orders";

export type ValidatedQrWaitLine = { line: QrCartLine; itemName: string; unitPrice: number; lineTotal: number;
  optionSnapshots: Array<{ modifierOptionId: number; qty: number; optionName: string; unitPrice: string }> };

export function configuredQrVisitTtlDays() {
  const value = Number(process.env.QR_VISIT_TTL_DAYS ?? 180);
  return Number.isInteger(value) && value >= 1 && value <= 365 ? value : 180;
}

export function configuredQrWaitTtlHours() {
  const value = Number(process.env.QR_WAIT_ORDER_TTL_HOURS ?? 24);
  return Number.isInteger(value) && value >= 1 && value <= 72 ? value : 24;
}

export function enrichQrCatalog(catalog: Awaited<ReturnType<typeof import("@/lib/qr-menu-catalog").loadQrMenuCatalog>>): QrCatalog {
  const menus = catalog.menus.map(menu => ({ ...menu, groups: groupQrModifiers(catalog.modifierGroups, menu.menuId) }));
  return { categories: catalog.categories, menus };
}

export function validateQrWaitCart(value: unknown, catalog: QrCatalog): ValidatedQrWaitLine[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return null;
  const seen = new Set<string>();
  const output: ValidatedQrWaitLine[] = [];
  for (const candidate of value) {
    const normalized = normalizeQrCart([candidate], catalog);
    if (normalized.length !== 1) return null;
    const line = normalized[0];
    const signature = `${line.menuId}:${line.options.map(option => `${option.modifierOptionId}.${option.qty}`).join(",")}`;
    if (seen.has(signature)) return null;
    seen.add(signature);
    const menu = catalog.menus.find(item => item.menuId === line.menuId);
    if (!menu) return null;
    const unitPrice = qrLineUnitPrice(menu, line.options);
    if (!Number.isSafeInteger(Math.round(unitPrice * 100)) || unitPrice < 0) return null;
    const menuOptions = menu.groups.flatMap(group => group.options);
    const optionSnapshots = line.options.map(selected => {
      const option = menuOptions.find(candidate => candidate.modifierOptionId === selected.modifierOptionId);
      return option ? { ...selected, optionName: option.optionName, unitPrice: option.priceDelta } : null;
    });
    if (optionSnapshots.some(option => option === null)) return null;
    output.push({ line, itemName: menu.name, unitPrice, lineTotal: qrLineTotal(menu, line.options, line.qty),
      optionSnapshots: optionSnapshots as ValidatedQrWaitLine["optionSnapshots"] });
  }
  return output;
}

export function qrWaitCartTotal(lines: ValidatedQrWaitLine[]) {
  return lines.reduce((sum, line) => sum + line.lineTotal, 0);
}

export function qrWaitOrderDisplayId(value: number) {
  return `tdkon_qr_wait_${value}`;
}
