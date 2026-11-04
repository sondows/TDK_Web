import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { diningTables, orderItemCancellations, orderItemOptions, orderItems, orders,
  tableSessionMerges, tableSessions } from "@/db/schema";
import { getCurrentHosStaff } from "@/lib/hos-auth";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ tableId: string }> }) {
  if (!await getCurrentHosStaff()) return Response.json({ success: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const tableId = Number((await params).tableId);
    if (!Number.isSafeInteger(tableId) || tableId <= 0) return Response.json({ success: false }, { status: 400 });
    const [table] = await db.select({ tableId: diningTables.tableId, tableNo: diningTables.tableNo,
      tableName: diningTables.tableName, capacity: diningTables.capacity }).from(diningTables)
      .where(and(eq(diningTables.tableId, tableId), eq(diningTables.isActive, 1))).limit(1);
    if (!table) return Response.json({ success: false }, { status: 404 });
    const [main] = await db.select({ sessionId: tableSessions.sessionId, groupId: tableSessions.groupId,
      personCount: tableSessions.personCount, babyCount: tableSessions.babyCount, openedAt: tableSessions.openedAt })
      .from(tableSessions).where(and(eq(tableSessions.tableId, tableId), eq(tableSessions.status, "OPEN"))).limit(1);
    if (!main) return Response.json({ success: true, table, session: null, orders: [] },
      { headers: { "Cache-Control": "no-store" } });
    const mergeRows = await db.select({ sourceSessionId: tableSessionMerges.sourceSessionId })
      .from(tableSessionMerges).where(and(eq(tableSessionMerges.destinationSessionId, main.sessionId),
        eq(tableSessionMerges.status, "ACTIVE")));
    const sessionIds = [main.sessionId, ...mergeRows.map(row => row.sourceSessionId)];
    const orderRows = await db.select({ orderId: orders.orderId, sessionId: orders.sessionId,
      orderedAt: orders.orderedAt, status: orders.status, totalAmount: orders.totalAmount })
      .from(orders).where(inArray(orders.sessionId, sessionIds)).orderBy(orders.orderId);
    const orderIds = orderRows.map(row => row.orderId);
    const items = orderIds.length ? await db.select({ orderItemId: orderItems.orderItemId, orderId: orderItems.orderId,
      menuId: orderItems.menuId, parentOrderItemId: orderItems.parentOrderItemId, itemType: orderItems.itemType,
      itemName: orderItems.itemName, qty: orderItems.qty, actualComponentQty: orderItems.actualComponentQty,
      unitPrice: orderItems.unitPrice, totalAmount: orderItems.totalAmount, status: orderItems.status })
      .from(orderItems).where(inArray(orderItems.orderId, orderIds)).orderBy(orderItems.orderItemId) : [];
    const itemIds = items.map(row => row.orderItemId);
    const [options, cancels] = itemIds.length ? await Promise.all([
      db.select({ orderItemId: orderItemOptions.orderItemId, modifierOptionId: orderItemOptions.modifierOptionId,
        optionName: orderItemOptions.optionName, qty: orderItemOptions.qty, unitPrice: orderItemOptions.unitPrice })
        .from(orderItemOptions).where(inArray(orderItemOptions.orderItemId, itemIds)),
      db.select({ cancellationId: orderItemCancellations.cancellationId, orderItemId: orderItemCancellations.orderItemId,
        cancelledQty: orderItemCancellations.cancelledQty, cancellationReason: orderItemCancellations.cancellationReason,
        cancelledAt: orderItemCancellations.cancelledAt }).from(orderItemCancellations)
        .where(inArray(orderItemCancellations.orderItemId, itemIds)).orderBy(orderItemCancellations.cancelledAt),
    ]) : [[], []];
    const byOptions = new Map<number, typeof options>();
    for (const option of options) byOptions.set(option.orderItemId,
      [...(byOptions.get(option.orderItemId) ?? []), option]);
    const byCancels = new Map<number, typeof cancels>();
    for (const cancel of cancels) byCancels.set(cancel.orderItemId,
      [...(byCancels.get(cancel.orderItemId) ?? []), cancel]);
    const responseOrders = orderRows.map(order => ({ ...order,
      items: items.filter(item => item.orderId === order.orderId).map(item => {
        const itemCancels = byCancels.get(item.orderItemId) ?? [];
        const cancelledQty = itemCancels.reduce((sum, row) => sum + row.cancelledQty, 0);
        const originalQty = item.actualComponentQty ?? item.qty;
        return { ...item, cancelledQty,
          effectiveQty: order.status === "CANCELLED" || item.status === "CANCELLED" ? 0 : Math.max(0, originalQty - cancelledQty),
          options: byOptions.get(item.orderItemId) ?? [], cancellations: itemCancels };
      }),
    }));
    return Response.json({ success: true, table,
      session: { sessionId: main.sessionId, groupId: main.groupId, personCount: main.personCount,
        babyCount: main.babyCount, openedAt: main.openedAt, relatedSessionIds: sessionIds },
      orders: responseOrders,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("HOS table details unavailable", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "주문 내역을 불러오지 못했습니다." }, { status: 503,
      headers: { "Cache-Control": "no-store" } });
  }
}
