import { pool } from "@/db";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { summarizeSalesFinancials, type FinancialCheckout, type FinancialPayment } from "@/lib/sales-financial-summary";

export type SalesSource = "LEGACY_POS" | "TDK_POS";
export type DailySales = {
  businessDate: string;
  source: SalesSource;
  salesAmount: number;
  saleCount: number;
  discountAmount: number;
  cardAmount: number;
  cashAmount: number;
  bankTransferAmount: number;
  otherAmount: number;
  overlapWithOtherSource: boolean;
  guestCount: number;
  incompleteGuestCount: number;
  durationTotalMinutes: number;
  durationCount: number;
};

type LegacyRow = RowDataPacket & { businessDate: string; netSales: string; saleCount: number; discountAmount: string; cardAmount: string; cashAmount: string; bankTransferAmount: string; otherAmount: string };
type CheckoutRow = RowDataPacket & FinancialCheckout & { businessDate: string };
type PaymentRow = RowDataPacket & FinancialPayment & { businessDate: string };
type SessionRow = RowDataPacket & { checkoutId: number; sessionId: number; groupId: number | null; adults: number; children: number; openedAt: Date; closedAt: Date | null };
type GroupSessionRow = RowDataPacket & { sessionId: number; groupId: number | null; adults: number; children: number; openedAt: Date; closedAt: Date | null };
type MergeRow = RowDataPacket & { sourceId: number; destinationId: number };
const checkoutBusinessDate = `COALESCE((SELECT MIN(bs.business_date) FROM checkout_items ci
  JOIN order_items oi ON oi.order_item_id = ci.order_item_id
  JOIN orders o ON o.order_id = oi.order_id
  JOIN table_sessions ts ON ts.session_id = o.session_id
  JOIN business_sessions bs ON bs.business_session_id = ts.business_session_id
  WHERE ci.checkout_id = c.checkout_id), DATE(c.completed_at))`;

async function loadCheckoutSessions(connection: PoolConnection, checkoutIds: number[]) {
  const result = new Map<number, GroupSessionRow[]>();
  if (!checkoutIds.length) return result;
  const [linked] = await connection.query<SessionRow[]>(
    "SELECT DISTINCT ci.checkout_id AS checkoutId, ts.session_id AS sessionId, ts.group_id AS groupId, ts.person_count AS adults, ts.baby_count AS children, ts.opened_at AS openedAt, ts.closed_at AS closedAt FROM checkout_items ci JOIN order_items oi ON oi.order_item_id = ci.order_item_id JOIN orders o ON o.order_id = oi.order_id JOIN table_sessions ts ON ts.session_id = o.session_id WHERE ci.checkout_id IN (?)",
    [checkoutIds],
  );
  const linkedIds = [...new Set(linked.map(row => row.sessionId))];
  const groupIds = [...new Set(linked.map(row => row.groupId).filter((id): id is number => id !== null))];
  const [groupSessions] = groupIds.length ? await connection.query<GroupSessionRow[]>(
    "SELECT session_id AS sessionId, group_id AS groupId, person_count AS adults, baby_count AS children, opened_at AS openedAt, closed_at AS closedAt FROM table_sessions WHERE group_id IN (?)", [groupIds],
  ) : [[] as GroupSessionRow[]];
  const [merges] = linkedIds.length ? await connection.query<MergeRow[]>(
    "SELECT source_session_id AS sourceId, destination_session_id AS destinationId FROM table_session_merges WHERE status = 'ACTIVE' AND (source_session_id IN (?) OR destination_session_id IN (?))", [linkedIds, linkedIds],
  ) : [[] as MergeRow[]];
  const mergedIds = [...new Set(merges.flatMap(row => [row.sourceId, row.destinationId]))];
  const [mergedSessions] = mergedIds.length ? await connection.query<GroupSessionRow[]>(
    "SELECT session_id AS sessionId, group_id AS groupId, person_count AS adults, baby_count AS children, opened_at AS openedAt, closed_at AS closedAt FROM table_sessions WHERE session_id IN (?)", [mergedIds],
  ) : [[] as GroupSessionRow[]];
  const byId = new Map([...groupSessions, ...mergedSessions, ...linked].map(row => [row.sessionId, row]));
  const linkedByCheckout = new Map<number, SessionRow[]>();
  for (const row of linked) linkedByCheckout.set(row.checkoutId, [...(linkedByCheckout.get(row.checkoutId) ?? []), row]);
  for (const [checkoutId, rows] of linkedByCheckout) {
    const ids = new Set(rows.map(row => row.sessionId));
    for (const row of rows) if (row.groupId !== null)
      for (const member of groupSessions) if (member.groupId === row.groupId) ids.add(member.sessionId);
    for (const merge of merges) if (ids.has(merge.sourceId) || ids.has(merge.destinationId)) {
      ids.add(merge.sourceId); ids.add(merge.destinationId);
    }
    result.set(checkoutId, [...ids].map(id => byId.get(id)!).filter(Boolean));
  }
  return result;
}

/** Uses the same completed_at, APPROVED applied_amount and checkout count rules as /api/sales/summary. */
export async function loadUnifiedDailySales(start: string, endExclusive: string): Promise<DailySales[]> {
  const connection = await pool.getConnection();
  try {
    await connection.query("START TRANSACTION READ ONLY");
    const [legacy] = await connection.query<LegacyRow[]>(
      "SELECT DATE_FORMAT(business_date, '%Y-%m-%d') AS businessDate, net_sales AS netSales, sale_count AS saleCount, discount_amount AS discountAmount, card_amount AS cardAmount, cash_amount AS cashAmount, bank_transfer_amount AS bankTransferAmount, other_amount AS otherAmount FROM legacy_daily_sales WHERE source = 'LEGACY_POS' AND business_date >= ? AND business_date < ?",
      [start, endExclusive],
    );
    const [checkouts] = await connection.query<CheckoutRow[]>(
      `SELECT c.checkout_id AS id, DATE_FORMAT(${checkoutBusinessDate}, '%Y-%m-%d') AS businessDate, c.total_amount AS total, c.discount_amount AS discount FROM checkouts c WHERE c.completed_at IS NOT NULL AND ${checkoutBusinessDate} >= ? AND ${checkoutBusinessDate} < ?`,
      [start, endExclusive],
    );
    const [payments] = await connection.query<PaymentRow[]>(
      `SELECT p.checkout_id AS checkoutId, DATE_FORMAT(${checkoutBusinessDate}, '%Y-%m-%d') AS businessDate, p.applied_amount AS appliedAmount, pm.method_type AS methodType, p.status, DATE_FORMAT(p.cancelled_at, '%Y-%m-%d') AS cancelledAt FROM payments p INNER JOIN checkouts c ON c.checkout_id = p.checkout_id INNER JOIN payment_methods pm ON pm.payment_method_id = p.payment_method_id WHERE c.completed_at IS NOT NULL AND ${checkoutBusinessDate} >= ? AND ${checkoutBusinessDate} < ?`,
      [start, endExclusive],
    );
    const sessionsByCheckout = await loadCheckoutSessions(connection, checkouts.map(row => row.id));
    const checkoutByDay = new Map<string, FinancialCheckout[]>();
    const paymentByDay = new Map<string, FinancialPayment[]>();
    for (const row of checkouts) checkoutByDay.set(row.businessDate, [...(checkoutByDay.get(row.businessDate) ?? []), row]);
    for (const row of payments) paymentByDay.set(row.businessDate, [...(paymentByDay.get(row.businessDate) ?? []), row]);
    const current = new Map<string, DailySales>();
    for (const [date, dayCheckouts] of checkoutByDay) {
      const money = summarizeSalesFinancials(dayCheckouts, paymentByDay.get(date) ?? [], date, date);
      const approvedByCheckout = new Map<number, number>();
      for (const payment of paymentByDay.get(date) ?? []) if (payment.status === "APPROVED")
        approvedByCheckout.set(payment.checkoutId, (approvedByCheckout.get(payment.checkoutId) ?? 0) + Math.max(0, Math.floor(Number(payment.appliedAmount))));
      let guestCount = 0, incompleteGuestCount = 0, durationTotalMinutes = 0, durationCount = 0;
      for (const checkout of dayCheckouts) {
        if ((approvedByCheckout.get(checkout.id) ?? 0) <= 0) continue;
        const sessions = sessionsByCheckout.get(checkout.id) ?? [];
        const people = sessions.reduce((sum, session) => sum + session.adults + session.children, 0);
        if (!sessions.length || people <= 0) incompleteGuestCount++;
        else guestCount += people;
        if (sessions.length && sessions.every(session => session.closedAt)) {
          const first = Math.min(...sessions.map(session => session.openedAt.getTime()));
          const last = Math.max(...sessions.map(session => session.closedAt!.getTime()));
          if (last >= first) { durationTotalMinutes += (last - first) / 60_000; durationCount++; }
        }
      }
      current.set(date, {
        businessDate: date, source: "TDK_POS", salesAmount: money.netSales, saleCount: money.transactionCount,
        discountAmount: money.discountAmount, cardAmount: money.cardAmount, cashAmount: money.cashAmount,
        bankTransferAmount: money.bankTransferAmount, otherAmount: money.otherAmount - money.bankTransferAmount,
        overlapWithOtherSource: false,
        guestCount, incompleteGuestCount, durationTotalMinutes, durationCount,
      });
    }
    // The production checkout history begins on 2026-10-03. TEST contains six
    // earlier checkout dates that overlap the legacy archive. On any overlap,
    // select the legacy daily row; never add the two sources for that date.
    const combined = new Map(current);
    for (const row of legacy) combined.set(row.businessDate, {
      businessDate: row.businessDate, source: "LEGACY_POS", salesAmount: Number(row.netSales),
      saleCount: Number(row.saleCount), discountAmount: Number(row.discountAmount),
      cardAmount: Number(row.cardAmount), cashAmount: Number(row.cashAmount),
      bankTransferAmount: Number(row.bankTransferAmount), otherAmount: Number(row.otherAmount),
      overlapWithOtherSource: current.has(row.businessDate),
      guestCount: 0, incompleteGuestCount: 0, durationTotalMinutes: 0, durationCount: 0,
    });
    return [...combined.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  } finally {
    try { await connection.rollback(); }
    finally { connection.release(); }
  }
}

export const emptyTotals = () => ({ salesAmount: 0, saleCount: 0, discountAmount: 0, cardAmount: 0, cashAmount: 0, bankTransferAmount: 0, otherAmount: 0 });
export function addTotals<T extends Pick<DailySales, "salesAmount" | "saleCount" | "discountAmount" | "cardAmount" | "cashAmount" | "bankTransferAmount" | "otherAmount">>(rows: T[]) {
  return rows.reduce((sum, row) => {
    sum.salesAmount += row.salesAmount;
    sum.saleCount += row.saleCount;
    sum.discountAmount += row.discountAmount;
    sum.cardAmount += row.cardAmount;
    sum.cashAmount += row.cashAmount;
    sum.bankTransferAmount += row.bankTransferAmount;
    sum.otherAmount += row.otherAmount;
    return sum;
  }, emptyTotals());
}
