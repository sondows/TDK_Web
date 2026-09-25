import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import {
  diningTables,
  menuCategories,
  menus,
  orderItems,
  orders,
  tableSessions,
} from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import SessionOrderScreen from "./SessionOrderScreen";

export default async function SessionOrderPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const currentStaff = await getCurrentStaff();
  if (!currentStaff) redirect("/login");

  const { sessionId: sessionIdParam } = await params;
  const sessionId = Number(sessionIdParam);
  if (!Number.isInteger(sessionId) || sessionId <= 0) redirect("/pos");

  const [tableSession] = await db
    .select({
      sessionId: tableSessions.sessionId,
      tableName: diningTables.tableName,
      tableId: diningTables.tableId,
      personCount: tableSessions.personCount,
      babyCount: tableSessions.babyCount,
      openedAt: tableSessions.openedAt,
    })
    .from(tableSessions)
    .innerJoin(diningTables, eq(tableSessions.tableId, diningTables.tableId))
    .where(
      and(
        eq(tableSessions.sessionId, sessionId),
        eq(tableSessions.status, "OPEN")
      )
    )
    .limit(1);

  if (!tableSession) redirect("/pos");

  const categories = await db
    .select({
      categoryId: menuCategories.categoryId,
      posName: menuCategories.posName,
    })
    .from(menuCategories)
    .where(eq(menuCategories.isActive, 1))
    .orderBy(menuCategories.sortOrder);

  const activeMenus = await db
    .select({
      menuId: menus.menuId,
      categoryId: menus.categoryId,
      posName: menus.posName,
      price: menus.price,
    })
    .from(menus)
    .where(eq(menus.isActive, 1))
    .orderBy(menus.sortOrder);

  const sessionOrders = await db
    .select({
      orderId: orders.orderId,
      orderedAt: orders.orderedAt,
      totalAmount: orders.totalAmount,
    })
    .from(orders)
    .where(eq(orders.sessionId, sessionId))
    .orderBy(desc(orders.orderedAt));

  const orderIds = sessionOrders.map((order) => order.orderId);
  const sessionOrderItems =
    orderIds.length > 0
      ? await db
          .select({
            orderId: orderItems.orderId,
            orderItemId: orderItems.orderItemId,
            itemName: orderItems.itemName,
            qty: orderItems.qty,
            unitPrice: orderItems.unitPrice,
            totalAmount: orderItems.totalAmount,
            status: orderItems.status,
          })
          .from(orderItems)
          .where(inArray(orderItems.orderId, orderIds))
          .orderBy(orderItems.orderItemId)
      : [];

  const orderHistory = sessionOrders.map((order) => ({
    ...order,
    items: sessionOrderItems.filter((item) => item.orderId === order.orderId),
  }));

  return (
    <SessionOrderScreen
      categories={categories}
      menus={activeMenus}
      orders={orderHistory}
      session={{
        ...tableSession,
        tableName: tableSession.tableName ?? `테이블 ${tableSession.tableId}`,
      }}
    />
  );
}
