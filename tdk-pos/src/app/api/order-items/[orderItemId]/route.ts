import { and, eq, ne } from "drizzle-orm";

import { db } from "@/db";
import { orderItems, orders, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { syncRiceOrderItemStock } from "@/lib/rice-stock";

const CENTS_PER_UNIT = BigInt(100);

class CancellationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function decimalToCents(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error("Invalid order item amount");

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return whole * CENTS_PER_UNIT + fraction;
}

function centsToDecimal(value: bigint) {
  const whole = value / CENTS_PER_UNIT;
  const fraction = (value % CENTS_PER_UNIT).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ orderItemId: string }> }
) {
  try {
    const currentStaff = await getCurrentStaff();
    if (!currentStaff) {
      return Response.json(
        { success: false, message: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const { orderItemId: orderItemIdParam } = await params;
    const orderItemId = Number(orderItemIdParam);
    if (!Number.isInteger(orderItemId) || orderItemId <= 0) {
      return Response.json(
        { success: false, message: "유효한 주문 항목 번호가 필요합니다." },
        { status: 400 }
      );
    }

    await db.transaction(async (tx) => {
      const [orderItem] = await tx
        .select({
          orderItemId: orderItems.orderItemId,
          menuId: orderItems.menuId,
          itemStatus: orderItems.status,
          orderId: orders.orderId,
          orderStatus: orders.status,
          sessionStatus: tableSessions.status,
        })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.orderId))
        .innerJoin(tableSessions, eq(orders.sessionId, tableSessions.sessionId))
        .where(eq(orderItems.orderItemId, orderItemId))
        .limit(1);

      if (!orderItem) {
        throw new CancellationError("주문 항목을 찾을 수 없습니다.", 404);
      }

      if (orderItem.sessionStatus !== "OPEN") {
        throw new CancellationError("종료된 테이블의 주문은 취소할 수 없습니다.", 409);
      }

      if (orderItem.itemStatus === "CANCELLED") {
        throw new CancellationError("이미 취소된 주문 항목입니다.", 409);
      }

      const [cancelResult] = await tx
        .update(orderItems)
        .set({
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledByStaffId: currentStaff.staffId,
        })
        .where(
          and(
            eq(orderItems.orderItemId, orderItemId),
            ne(orderItems.status, "CANCELLED")
          )
        );

      if (cancelResult.affectedRows !== 1) {
        throw new CancellationError("이미 취소된 주문 항목입니다.", 409);
      }

      await syncRiceOrderItemStock(tx, orderItemId, orderItem.menuId, 0, currentStaff.staffId);

      const remainingItems = await tx
        .select({ totalAmount: orderItems.totalAmount })
        .from(orderItems)
        .where(
          and(
            eq(orderItems.orderId, orderItem.orderId),
            ne(orderItems.status, "CANCELLED")
          )
        );

      const subtotalCents = remainingItems.reduce(
        (total, item) => total + decimalToCents(item.totalAmount),
        BigInt(0)
      );
      const subtotalAmount = centsToDecimal(subtotalCents);

      await tx
        .update(orders)
        .set({
          subtotalAmount,
          discountAmount: "0.00",
          totalAmount: subtotalAmount,
          status: remainingItems.length === 0 ? "CANCELLED" : orderItem.orderStatus,
        })
        .where(eq(orders.orderId, orderItem.orderId));
    });

    return Response.json({ success: true, message: "주문 항목을 취소했습니다." });
  } catch (error) {
    if (error instanceof CancellationError) {
      return Response.json(
        { success: false, message: error.message },
        { status: error.status }
      );
    }

    console.error("주문 항목 취소 오류:", error);
    return Response.json(
      { success: false, message: "주문 항목 취소에 실패했습니다." },
      { status: 500 }
    );
  }
}
