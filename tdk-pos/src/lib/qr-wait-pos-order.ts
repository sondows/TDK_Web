import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { menuComponents, menuModifierGroups, menus, modifierGroups, modifierOptions, orderItemOptions, orderItems, orders } from "@/db/schema";
import { syncRiceOrderItemStock } from "@/lib/rice-stock";
import { hasConsistentPotSpiciness } from "@/lib/pos-pot-spiciness";

type Tx = Parameters<Parameters<typeof import("@/db").db.transaction>[0]>[0];
export type WaitOrderInputItem = { menuId: number; qty: number; options: Array<{ modifierOptionId: number; qty: number }> };
const cents = BigInt(100);
function toCents(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new WaitOrderValidationError("현재 메뉴 가격을 읽지 못했습니다.");
  const result = BigInt(match[2]) * cents + BigInt((match[3] ?? "").padEnd(2, "0") || "0");
  return match[1] === "-" ? -result : result;
}
function toDecimal(value: bigint) {
  const abs = value < 0 ? -value : value;
  return `${value < 0 ? "-" : ""}${abs / cents}.${(abs % cents).toString().padStart(2, "0")}`;
}

export class WaitOrderValidationError extends Error {}

export async function buildWaitOrderSnapshots(tx: Tx, items: WaitOrderInputItem[]) {
  if (!items.length || items.length > 100 || items.some(item => !Number.isSafeInteger(item.menuId) || item.menuId <= 0 || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 99)) {
    throw new WaitOrderValidationError("대기 주문 메뉴 수량을 확인해 주세요.");
  }
  const menuIds = [...new Set(items.map(item => item.menuId))];
  const menuRows = await tx.select({ menuId: menus.menuId, posName: menus.posName, price: menus.price,
    prepStationId: menus.prepStationId, kdsKind: menus.kdsKind, kdsGroupKey: menus.kdsGroupKey })
    .from(menus).where(and(inArray(menus.menuId, menuIds), eq(menus.isActive, 1), eq(menus.isQrVisible, 1)));
  if (menuRows.length !== menuIds.length) throw new WaitOrderValidationError("판매할 수 없는 메뉴가 대기 주문에 포함되어 있습니다.");
  const optionIds = [...new Set(items.flatMap(item => item.options.map(option => option.modifierOptionId)))];
  const optionRows = optionIds.length ? await tx.select({ menuId: menuModifierGroups.menuId,
    modifierGroupId: modifierGroups.modifierGroupId, groupName: modifierGroups.posName,
    minSelect: modifierGroups.minSelect, maxSelect: modifierGroups.maxSelect, isRequired: modifierGroups.isRequired,
    modifierOptionId: modifierOptions.modifierOptionId, optionName: modifierOptions.posName,
    priceDelta: modifierOptions.priceDelta })
    .from(menuModifierGroups).innerJoin(modifierGroups, and(eq(modifierGroups.modifierGroupId, menuModifierGroups.modifierGroupId), eq(modifierGroups.isActive, 1)))
    .innerJoin(modifierOptions, and(eq(modifierOptions.modifierGroupId, modifierGroups.modifierGroupId), eq(modifierOptions.isActive, 1)))
    .where(and(inArray(menuModifierGroups.menuId, menuIds), inArray(modifierOptions.modifierOptionId, optionIds))) : [];
  const configuredGroupRows = await tx.select({ menuId: menuModifierGroups.menuId, modifierGroupId: modifierGroups.modifierGroupId,
    minSelect: modifierGroups.minSelect, maxSelect: modifierGroups.maxSelect, isRequired: modifierGroups.isRequired,
    active: modifierGroups.isActive }).from(menuModifierGroups)
    .innerJoin(modifierGroups, eq(modifierGroups.modifierGroupId, menuModifierGroups.modifierGroupId))
    .where(inArray(menuModifierGroups.menuId, menuIds));
  const componentMenu = alias(menus, "qr_wait_component_menu");
  const componentRows = await tx.select({ menuComponentId: menuComponents.menuComponentId,
    parentMenuId: menuComponents.parentMenuId, componentMenuId: menuComponents.componentMenuId,
    itemName: componentMenu.posName, prepStationId: componentMenu.prepStationId,
    active: componentMenu.isActive, qtyPerUnit: menuComponents.qtyPerUnit,
    printOnReceipt: menuComponents.printOnReceipt }).from(menuComponents)
    .innerJoin(componentMenu, eq(componentMenu.menuId, menuComponents.componentMenuId))
    .where(inArray(menuComponents.parentMenuId, menuIds));
  const byMenu = new Map(menuRows.map(menu => [menu.menuId, menu]));
  const componentByMenu = new Map<number, typeof componentRows>();
  componentRows.forEach(component => componentByMenu.set(component.parentMenuId, [...(componentByMenu.get(component.parentMenuId) ?? []), component]));
  const groupByMenu = new Map<number, typeof configuredGroupRows>();
  configuredGroupRows.forEach(group => groupByMenu.set(group.menuId, [...(groupByMenu.get(group.menuId) ?? []), group]));
  let total = BigInt(0);
  const snapshots = items.map(item => {
    const menu = byMenu.get(item.menuId)!;
    const chosenIds = new Set(item.options.map(option => option.modifierOptionId));
    const groups = groupByMenu.get(menu.menuId) ?? [];
    for (const group of groups) {
      if (group.active !== 1) throw new WaitOrderValidationError("메뉴 옵션 구성이 변경되었습니다. 직원이 확인해 주세요.");
      const count = item.options.filter(selected => optionRows.some(option => option.menuId === menu.menuId && option.modifierGroupId === group.modifierGroupId && option.modifierOptionId === selected.modifierOptionId)).length;
      if (count < Math.max(group.minSelect, group.isRequired ? 1 : 0) || count > group.maxSelect) throw new WaitOrderValidationError("메뉴 옵션 구성이 변경되었습니다. 직원이 확인해 주세요.");
    }
    const options = item.options.map(selected => {
      const option = optionRows.find(row => row.menuId === menu.menuId && row.modifierOptionId === selected.modifierOptionId);
      if (!option || selected.qty !== 1) throw new WaitOrderValidationError("메뉴 옵션 구성이 변경되었습니다. 직원이 확인해 주세요.");
      return { ...option, qty: selected.qty };
    });
    if (chosenIds.size !== item.options.length) throw new WaitOrderValidationError("중복 옵션이 포함되어 있습니다.");
    const optionCents = options.reduce((sum, option) => sum + toCents(option.priceDelta) * BigInt(option.qty), BigInt(0));
    const unitPriceCents = toCents(menu.price) + optionCents;
    if (unitPriceCents < 0) throw new WaitOrderValidationError("현재 옵션 금액을 확인해 주세요.");
    const lineCents = unitPriceCents * BigInt(item.qty);
    total += lineCents;
    const components = componentByMenu.get(menu.menuId) ?? [];
    if (components.some(component => component.active !== 1)) throw new WaitOrderValidationError("메뉴 구성 항목이 변경되었습니다. 직원이 확인해 주세요.");
    return { menu, qty: item.qty, unitPrice: toDecimal(unitPriceCents), lineAmount: toDecimal(lineCents), options, components };
  });
  if (!hasConsistentPotSpiciness(snapshots.flatMap(snapshot => {
    if (snapshot.menu.kdsKind !== "POT") return [];
    const taste = snapshot.options.find(option => option.groupName === "매운맛" || /^\s*\d+\s*[.번]/.test(option.optionName));
    return [{ potKey: snapshot.menu.kdsGroupKey?.trim() || "POT", optionName: taste?.optionName ?? null }];
  }))) throw new WaitOrderValidationError("같은 냄비 메뉴의 매운맛 옵션을 동일하게 선택해 주세요.");
  return { snapshots, total: toDecimal(total) };
}

export async function insertWaitOrderAsPosOrder(tx: Tx, sessionId: number, staffId: number, snapshots: Awaited<ReturnType<typeof buildWaitOrderSnapshots>>["snapshots"], total: string) {
  const [inserted] = await tx.insert(orders).values({ sessionId, orderType: "POS", status: "ACCEPTED",
    subtotalAmount: total, discountAmount: "0.00", totalAmount: total, createdByStaffId: staffId,
    acceptedByStaffId: staffId, acceptedAt: new Date() });
  const orderId = Number(inserted.insertId);
  for (const snapshot of snapshots) {
    const [parent] = await tx.insert(orderItems).values({ orderId, menuId: snapshot.menu.menuId,
      itemName: snapshot.menu.posName, qty: snapshot.qty, unitPrice: snapshot.unitPrice,
      discountAmount: "0.00", totalAmount: snapshot.lineAmount, prepStationId: snapshot.menu.prepStationId,
      itemType: "NORMAL", status: "ORDERED", printOnReceipt: 1 });
    const parentId = Number(parent.insertId);
    if (snapshot.options.length) await tx.insert(orderItemOptions).values(snapshot.options.map(option => ({
      orderItemId: parentId, modifierOptionId: option.modifierOptionId, optionName: option.optionName,
      qty: option.qty * snapshot.qty, unitPrice: option.priceDelta,
      totalAmount: toDecimal(toCents(option.priceDelta) * BigInt(option.qty) * BigInt(snapshot.qty)),
    })));
    await syncRiceOrderItemStock(tx, parentId, snapshot.menu.menuId, snapshot.qty, staffId, true);
    for (const component of snapshot.components) {
      const qty = component.qtyPerUnit * snapshot.qty;
      const [created] = await tx.insert(orderItems).values({ orderId, parentOrderItemId: parentId,
        menuId: component.componentMenuId, itemName: component.itemName, qty: Math.max(1, qty), actualComponentQty: qty,
        unitPrice: "0.00", discountAmount: "0.00", totalAmount: "0.00", prepStationId: component.prepStationId,
        itemType: "COMPONENT", status: "ORDERED", printOnReceipt: component.printOnReceipt });
      await syncRiceOrderItemStock(tx, Number(created.insertId), component.componentMenuId, qty, staffId, true);
    }
  }
  return orderId;
}
