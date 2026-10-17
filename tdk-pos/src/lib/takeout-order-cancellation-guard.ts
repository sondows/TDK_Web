import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { checkouts, paymentSessionAllocations, payments, tableSessions } from "@/db/schema";
import { db } from "@/db";

/** A completed takeout sale must have its payment cancelled before its menu can be cancelled. */
export async function assertNoCompletedTakeoutPayment(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  sessionIds: number[],
) {
  if (!sessionIds.length) return;
  const [paid] = await tx.select({ paymentId: payments.paymentId })
    .from(paymentSessionAllocations)
    .innerJoin(tableSessions, eq(tableSessions.sessionId, paymentSessionAllocations.sessionId))
    .innerJoin(payments, eq(payments.paymentId, paymentSessionAllocations.paymentId))
    .innerJoin(checkouts, eq(checkouts.checkoutId, payments.checkoutId))
    .where(and(
      inArray(paymentSessionAllocations.sessionId, sessionIds),
      sql`${tableSessions.sessionKind} <> 'DINE_IN'`,
      eq(payments.status, "APPROVED"),
      sql`${paymentSessionAllocations.appliedAmount} > 0`,
      eq(checkouts.status, "PAID"),
      isNotNull(checkouts.completedAt),
    )).for("update").limit(1);
  if (paid) throw new Error("결제 완료된 포장입니다. 결제창에서 결제를 취소한 뒤 메뉴를 취소해 주세요.");
}
