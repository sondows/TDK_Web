import { and, eq, inArray, ne } from "drizzle-orm";

import { db } from "@/db";
import { checkoutItems, checkouts, orderItemCancellations, orderItems, orders, payments, tableSessionDiscounts, tableSessionMerges, tableSessions } from "@/db/schema";
import { calculatePendingSales } from "@/lib/pending-sales-calculation";

/** Current open bills only. The database does not retain enough history for past dates. */
export async function loadCurrentPendingSales() {
  return db.transaction(async tx => {
    const sessions = await tx.select({ sessionId: tableSessions.sessionId, groupId: tableSessions.groupId })
      .from(tableSessions).where(eq(tableSessions.status, "OPEN"));
    if (!sessions.length) return { amount: 0, count: 0 };
    const sessionIds = sessions.map(row => row.sessionId);
    const merges = await tx.select({ sourceSessionId: tableSessionMerges.sourceSessionId, destinationSessionId: tableSessionMerges.destinationSessionId })
      .from(tableSessionMerges)
      .where(and(eq(tableSessionMerges.status, "ACTIVE"), inArray(tableSessionMerges.sourceSessionId, sessionIds)));
    const items = await tx.select({ orderItemId: orderItems.orderItemId, sessionId: orders.sessionId,
      qty: orderItems.qty, unitPrice: orderItems.unitPrice, status: orderItems.status })
      .from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.orderId))
      .where(and(inArray(orders.sessionId, sessionIds), ne(orders.status, "CANCELLED")));
    const discounts = await tx.select({ sessionId: tableSessionDiscounts.sessionId, discountAmount: tableSessionDiscounts.discountAmount })
      .from(tableSessionDiscounts).where(inArray(tableSessionDiscounts.sessionId, sessionIds));
    const itemIds = items.map(item => item.orderItemId);
    if (!itemIds.length) return { amount: 0, count: 0 };
    const cancellations = await tx.select({ orderItemId: orderItemCancellations.orderItemId, cancelledQty: orderItemCancellations.cancelledQty })
      .from(orderItemCancellations).where(inArray(orderItemCancellations.orderItemId, itemIds));
    const checkoutLinks = await tx.select({ checkoutId: checkoutItems.checkoutId, orderItemId: checkoutItems.orderItemId, status: checkouts.status })
      .from(checkoutItems).innerJoin(checkouts, eq(checkoutItems.checkoutId, checkouts.checkoutId))
      .where(inArray(checkoutItems.orderItemId, itemIds));
    const checkoutIds = [...new Set(checkoutLinks.map(row => row.checkoutId))];
    const paymentRows = checkoutIds.length
      ? await tx.select({ checkoutId: payments.checkoutId, appliedAmount: payments.appliedAmount })
        .from(payments).where(and(inArray(payments.checkoutId, checkoutIds), eq(payments.status, "APPROVED")))
      : [];
    return calculatePendingSales({ sessions, merges, items, cancellations, discounts, checkoutLinks, payments: paymentRows });
  });
}
