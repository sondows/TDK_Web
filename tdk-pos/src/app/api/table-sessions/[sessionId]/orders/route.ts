import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { menus, orderItems, orders, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";

type RequestedItem = {
  menuId: number;
  qty: number;
};

const CENTS_PER_UNIT = BigInt(100);

function decimalToCents(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error("Invalid menu price");

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return whole * CENTS_PER_UNIT + fraction;
}

function centsToDecimal(value: bigint) {
  const whole = value / CENTS_PER_UNIT;
  const fraction = (value % CENTS_PER_UNIT).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

function parseRequestedItems(value: unknown): RequestedItem[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    return null;
  }

  const quantities = new Map<number, number>();
  for (const item of value) {
    if (!item || typeof item !== "object") return null;

    const { menuId, qty } = item as { menuId?: unknown; qty?: unknown };
    const parsedMenuId = Number(menuId);
    const parsedQty = Number(qty);
    if (
      !Number.isInteger(parsedMenuId) ||
      parsedMenuId <= 0 ||
      !Number.isInteger(parsedQty) ||
      parsedQty <= 0 ||
      parsedQty > 1000
    ) {
      return null;
    }

    const nextQty = (quantities.get(parsedMenuId) ?? 0) + parsedQty;
    if (!Number.isSafeInteger(nextQty) || nextQty > 1000) return null;
    quantities.set(parsedMenuId, nextQty);
  }

  return [...quantities.entries()].map(([menuId, qty]) => ({ menuId, qty }));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const currentStaff = await getCurrentStaff();
    const sharedMode = await getPosLoginMode() === "SHARED";
    if (!currentStaff && !sharedMode) {
      return Response.json(
        { success: false, message: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const { sessionId: sessionIdParam } = await params;
    const sessionId = Number(sessionIdParam);
    const body = await request.json();
    const requestedItems = parseRequestedItems(body.items);

    if (!Number.isInteger(sessionId) || sessionId <= 0 || !requestedItems) {
      return Response.json(
        { success: false, message: "주문 요청이 올바르지 않습니다." },
        { status: 400 }
      );
    }

    await db.transaction(async (tx) => {
      const [tableSession] = await tx
        .select({ sessionId: tableSessions.sessionId })
        .from(tableSessions)
        .where(
          and(
            eq(tableSessions.sessionId, sessionId),
            eq(tableSessions.status, "OPEN")
          )
        )
        .limit(1);

      if (!tableSession) {
        throw new OrderValidationError("테이블이 이미 종료되었거나 존재하지 않습니다.");
      }

      const menuIds = requestedItems.map((item) => item.menuId);
      const availableMenus = await tx
        .select({
          menuId: menus.menuId,
          posName: menus.posName,
          price: menus.price,
          prepStationId: menus.prepStationId,
        })
        .from(menus)
        .where(and(inArray(menus.menuId, menuIds), eq(menus.isActive, 1)));

      if (availableMenus.length !== requestedItems.length) {
        throw new OrderValidationError("판매할 수 없는 메뉴가 포함되어 있습니다.");
      }

      const menuById = new Map(availableMenus.map((menu) => [menu.menuId, menu]));
      let totalCents = BigInt(0);
      const itemSnapshots = requestedItems.map((requestedItem) => {
        const menu = menuById.get(requestedItem.menuId);
        if (!menu) throw new OrderValidationError("메뉴를 찾을 수 없습니다.");

        const unitPriceCents = decimalToCents(menu.price);
        const itemTotalCents = unitPriceCents * BigInt(requestedItem.qty);
        totalCents += itemTotalCents;

        return {
          menuId: menu.menuId,
          itemName: menu.posName,
          qty: requestedItem.qty,
          unitPrice: centsToDecimal(unitPriceCents),
          totalAmount: centsToDecimal(itemTotalCents),
          prepStationId: menu.prepStationId,
        };
      });

      const totalAmount = centsToDecimal(totalCents);
      const [orderInsertResult] = await tx.insert(orders).values({
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
      const orderId = Number(orderInsertResult.insertId);

      await tx.insert(orderItems).values(
        itemSnapshots.map((item) => ({
          orderId,
          menuId: item.menuId,
          itemName: item.itemName,
          qty: item.qty,
          unitPrice: item.unitPrice,
          discountAmount: "0.00",
          totalAmount: item.totalAmount,
          prepStationId: item.prepStationId,
          itemType: "NORMAL" as const,
          status: "ORDERED" as const,
        }))
      );
    });

    return Response.json({ success: true, message: "주문을 저장했습니다." });
  } catch (error) {
    if (error instanceof OrderValidationError) {
      return Response.json(
        { success: false, message: error.message },
        { status: 409 }
      );
    }

    console.error("POS 주문 저장 오류:", error);
    return Response.json(
      { success: false, message: "주문 저장에 실패했습니다." },
      { status: 500 }
    );
  }
}

class OrderValidationError extends Error {}
