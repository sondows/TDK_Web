import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";

import { db } from "@/db";
import { menuComponents, menus, orderItems, orders, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { syncRiceOrderItemStock } from "@/lib/rice-stock";

type RequestedItem = { menuId: number; qty: number; components: Array<{ menuComponentId: number; qty: number }> };
const CENTS_PER_UNIT = BigInt(100);

function decimalToCents(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error("Invalid menu price");
  return BigInt(match[1]) * CENTS_PER_UNIT + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
}

function centsToDecimal(value: bigint) {
  return `${value / CENTS_PER_UNIT}.${(value % CENTS_PER_UNIT).toString().padStart(2, "0")}`;
}

function parseRequestedItems(value: unknown): RequestedItem[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return null;
  const quantities = new Map<number, number>();
  const requested: RequestedItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const row = item as { menuId?: unknown; qty?: unknown; components?: unknown };
    const menuId = Number(row.menuId);
    const qty = Number(row.qty);
    if (!Number.isSafeInteger(menuId) || menuId <= 0 || !Number.isInteger(qty) || qty <= 0 || qty > 1000) return null;
    const rawComponents = row.components;
    const components = rawComponents === undefined ? [] : Array.isArray(rawComponents) ? rawComponents.map(value => {
      const component = value as { menuComponentId?: unknown; qty?: unknown };
      return { menuComponentId: Number(component?.menuComponentId), qty: Number(component?.qty) };
    }) : null;
    if (components === null || components.length > 50 || components.some(component => !Number.isSafeInteger(component.menuComponentId) || component.menuComponentId <= 0 || !Number.isInteger(component.qty) || component.qty < 0 || component.qty > 1_000_000) || new Set(components.map(component => component.menuComponentId)).size !== components.length) return null;
    const nextQty = (quantities.get(menuId) ?? 0) + qty;
    if (!Number.isSafeInteger(nextQty) || nextQty > 1000) return null;
    quantities.set(menuId, nextQty);
    requested.push({ menuId, qty, components });
  }
  return requested;
}

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const currentStaff = await getCurrentStaff();
    const sharedMode = await getPosLoginMode() === "SHARED";
    if (!currentStaff && !sharedMode) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });

    const sessionId = Number((await params).sessionId);
    const body = await request.json() as { items?: unknown };
    const requestedItems = parseRequestedItems(body.items);
    if (!Number.isSafeInteger(sessionId) || sessionId <= 0 || !requestedItems) return Response.json({ success: false, message: "주문 요청이 올바르지 않습니다." }, { status: 400 });

    await db.transaction(async tx => {
      const [session] = await tx.select({ sessionId: tableSessions.sessionId }).from(tableSessions).where(and(eq(tableSessions.sessionId, sessionId), eq(tableSessions.status, "OPEN"))).limit(1);
      if (!session) throw new OrderValidationError("테이블 세션이 종료되었거나 존재하지 않습니다.");

      const menuIds = [...new Set(requestedItems.map(item => item.menuId))];
      const availableMenus = await tx.select({ menuId: menus.menuId, posName: menus.posName, price: menus.price, prepStationId: menus.prepStationId }).from(menus).where(and(inArray(menus.menuId, menuIds), eq(menus.isActive, 1)));
      if (availableMenus.length !== menuIds.length) throw new OrderValidationError("판매할 수 없는 메뉴가 포함되어 있습니다.");
      const menuById = new Map(availableMenus.map(menu => [menu.menuId, menu]));

      const componentMenu = alias(menus, "component_menu");
      const configuredComponents = await tx.select({
        menuComponentId: menuComponents.menuComponentId,
        parentMenuId: menuComponents.parentMenuId,
        componentMenuId: menuComponents.componentMenuId,
        itemName: componentMenu.posName,
        prepStationId: componentMenu.prepStationId,
        active: componentMenu.isActive,
        qtyPerUnit: menuComponents.qtyPerUnit,
        printOnReceipt: menuComponents.printOnReceipt,
      }).from(menuComponents).innerJoin(componentMenu, eq(componentMenu.menuId, menuComponents.componentMenuId)).where(inArray(menuComponents.parentMenuId, menuIds));
      const componentsByMenu = new Map<number, typeof configuredComponents>();
      configuredComponents.forEach(component => componentsByMenu.set(component.parentMenuId, [...(componentsByMenu.get(component.parentMenuId) ?? []), component]));

      let orderTotalCents = BigInt(0);
      const snapshots = requestedItems.map(requested => {
        const menu = menuById.get(requested.menuId);
        if (!menu) throw new OrderValidationError("메뉴를 찾을 수 없습니다.");
        const menuAmountCents = decimalToCents(menu.price) * BigInt(requested.qty);
        orderTotalCents += menuAmountCents;
        const configured = componentsByMenu.get(menu.menuId) ?? [];
        if (configured.some(component => component.active !== 1)) throw new OrderValidationError("사용할 수 없는 구성 메뉴가 포함되어 있습니다.");
        const requestedByComponent = new Map(requested.components.map(component => [component.menuComponentId, component.qty]));
        if (requested.components.length && (requested.components.length !== configured.length || configured.some(component => !requestedByComponent.has(component.menuComponentId)))) throw new OrderValidationError("구성 메뉴 설정이 변경되었습니다. 다시 시도해 주세요.");
        const components = configured.map(component => {
          const qty = requestedByComponent.has(component.menuComponentId) ? requestedByComponent.get(component.menuComponentId)! : component.qtyPerUnit * requested.qty;
          if (!Number.isSafeInteger(qty) || qty < 0 || qty > 1_000_000) throw new OrderValidationError("구성 메뉴 수량을 확인해 주세요.");
          return { ...component, qty };
        });
        return { menu, qty: requested.qty, menuAmount: centsToDecimal(menuAmountCents), components };
      });

      const totalAmount = centsToDecimal(orderTotalCents);
      const [orderInsert] = await tx.insert(orders).values({
        sessionId,
        orderType: "POS",
        status: "ACCEPTED",
        subtotalAmount: totalAmount,
        discountAmount: "0.00",
        totalAmount,
        createdByStaffId: currentStaff?.staffId,
        acceptedByStaffId: currentStaff?.staffId,
        acceptedAt: currentStaff ? new Date() : null,
      });
      const orderId = Number(orderInsert.insertId);
      for (const snapshot of snapshots) {
        const [parent] = await tx.insert(orderItems).values({ orderId, menuId: snapshot.menu.menuId, itemName: snapshot.menu.posName, qty: snapshot.qty, unitPrice: snapshot.menu.price, discountAmount: "0.00", totalAmount: snapshot.menuAmount, prepStationId: snapshot.menu.prepStationId, itemType: "NORMAL", status: "ORDERED", printOnReceipt: 1 });
        const parentOrderItemId = Number(parent.insertId);
        await syncRiceOrderItemStock(tx, parentOrderItemId, snapshot.menu.menuId, snapshot.qty, currentStaff?.staffId ?? null, true);
        for (const component of snapshot.components) {
          const [inserted] = await tx.insert(orderItems).values({ orderId, parentOrderItemId, menuId: component.componentMenuId, itemName: component.itemName, qty: Math.max(1, component.qty), actualComponentQty: component.qty, unitPrice: "0.00", discountAmount: "0.00", totalAmount: "0.00", prepStationId: component.prepStationId, itemType: "COMPONENT", status: "ORDERED", printOnReceipt: component.printOnReceipt });
          await syncRiceOrderItemStock(tx, Number(inserted.insertId), component.componentMenuId, component.qty, currentStaff?.staffId ?? null, true);
        }
      }
    });

    return Response.json({ success: true, message: "주문을 저장했습니다." });
  } catch (error) {
    if (error instanceof OrderValidationError) return Response.json({ success: false, message: error.message }, { status: 409 });
    console.error("POS 주문 저장 오류:", error);
    return Response.json({ success: false, message: "주문 저장에 실패했습니다." }, { status: 500 });
  }
}

class OrderValidationError extends Error {}
