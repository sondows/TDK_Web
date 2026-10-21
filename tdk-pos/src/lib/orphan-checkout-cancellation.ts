import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { checkoutItems, checkouts, orderItems, orders, payments } from "@/db/schema";
import { isOrphanedUnpaidCheckout } from "@/lib/orphan-checkout-cancellation-model";

type CheckoutTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Preserve checkout/payment history while closing unpaid checkouts whose source items were all cancelled. */
export async function cancelOrphanedUnpaidCheckouts(tx: CheckoutTx, sessionIds: number[]) {
  const uniqueSessionIds = [...new Set(sessionIds.filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!uniqueSessionIds.length) return;

  const candidates = await tx.selectDistinct({ checkoutId: checkouts.checkoutId })
    .from(checkoutItems)
    .innerJoin(checkouts, eq(checkouts.checkoutId, checkoutItems.checkoutId))
    .innerJoin(orderItems, eq(orderItems.orderItemId, checkoutItems.orderItemId))
    .innerJoin(orders, eq(orders.orderId, orderItems.orderId))
    .where(and(
      inArray(orders.sessionId, uniqueSessionIds),
      inArray(checkouts.status, ["OPEN", "PARTIALLY_PAID"]),
    ));

  for (const { checkoutId } of candidates) {
    const [checkout] = await tx.select({ status: checkouts.status, paidAmount: checkouts.paidAmount, completedAt: checkouts.completedAt })
      .from(checkouts).where(eq(checkouts.checkoutId, checkoutId)).for("update").limit(1);
    if (!checkout) continue;

    const items = await tx.select({ status: orderItems.status })
      .from(checkoutItems)
      .innerJoin(orderItems, eq(orderItems.orderItemId, checkoutItems.orderItemId))
      .where(eq(checkoutItems.checkoutId, checkoutId));
    const paymentRows = await tx.select({ status: payments.status })
      .from(payments).where(eq(payments.checkoutId, checkoutId));

    if (!isOrphanedUnpaidCheckout({
      checkoutStatus: checkout.status,
      paidAmount: Number(checkout.paidAmount),
      completedAt: checkout.completedAt,
      itemStatuses: items.map(item => item.status),
      paymentStatuses: paymentRows.map(payment => payment.status),
    })) continue;

    await tx.update(checkouts)
      .set({ status: "CANCELLED" })
      .where(and(
        eq(checkouts.checkoutId, checkoutId),
        inArray(checkouts.status, ["OPEN", "PARTIALLY_PAID"]),
      ));
  }
}
