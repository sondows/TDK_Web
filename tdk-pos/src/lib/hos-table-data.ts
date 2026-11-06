import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { RowDataPacket } from "mysql2";
import { db, pool } from "@/db";
import { diningTables, orderItemCancellations, orderItems, orders, paymentSessionAllocations,
  payments, systemSettings, tableSessionDiscounts, tableSessionMerges, tableSessions } from "@/db/schema";
import { calculateTableFinancials } from "@/lib/table-session-financials";
import { parseHosTableLayout, resolveHosTableLayouts } from "@/lib/hos-table-layout";

type QrSessionRow = RowDataPacket & { sessionId: number };

export async function loadHosTables(includeHidden = false) {
  const [tableRows, sessions, merges] = await Promise.all([
    db.select({ tableId: diningTables.tableId, tableNo: diningTables.tableNo, tableName: diningTables.tableName,
      capacity: diningTables.capacity }).from(diningTables).where(eq(diningTables.isActive, 1)),
    db.select({ sessionId: tableSessions.sessionId, tableId: tableSessions.tableId, personCount: tableSessions.personCount,
      babyCount: tableSessions.babyCount, openedAt: sql<string>`DATE_FORMAT(${tableSessions.openedAt}, '%Y-%m-%dT%H:%i:%s')` })
      .from(tableSessions).where(and(eq(tableSessions.status, "OPEN"), sql`${tableSessions.tableId} IS NOT NULL`)),
    db.select({ sourceSessionId: tableSessionMerges.sourceSessionId, destinationSessionId: tableSessionMerges.destinationSessionId,
      sourceTableId: tableSessionMerges.sourceTableId, destinationTableId: tableSessionMerges.destinationTableId })
      .from(tableSessionMerges).where(eq(tableSessionMerges.status, "ACTIVE")),
  ]);
  const settingKeys = tableRows.map(table => `hos.table-layout.${table.tableId}`);
  const settingRows = settingKeys.length
    ? await db.select({ settingKey: systemSettings.settingKey, settingValue: systemSettings.settingValue })
      .from(systemSettings).where(inArray(systemSettings.settingKey, settingKeys))
    : [];
  const storedLayouts = new Map<number, NonNullable<ReturnType<typeof parseHosTableLayout>>>();
  for (const setting of settingRows) {
    const tableId = Number(setting.settingKey.slice("hos.table-layout.".length));
    const parsed = parseHosTableLayout(setting.settingValue);
    if (Number.isInteger(tableId) && parsed) storedLayouts.set(tableId, parsed);
  }
  const layouts = resolveHosTableLayouts(tableRows.map(table => ({ ...table, tableId: Number(table.tableId) })), storedLayouts);

  const sessionIds = sessions.map(row => row.sessionId);
  const qrRows: QrSessionRow[] = sessionIds.length
    ? (await pool.query<QrSessionRow[]>(`SELECT DISTINCT qs.session_id AS sessionId
        FROM qr_orders qo
        INNER JOIN qr_sessions qs ON qs.qr_session_id = qo.qr_session_id
        WHERE qs.session_id IN (?)`, [sessionIds]))[0]
    : [];
  const sessionsWithQrOrders = new Set(qrRows.map(row => Number(row.sessionId)));
  const orderRows = sessionIds.length ? await db.select({ orderId: orders.orderId, sessionId: orders.sessionId,
    status: orders.status }).from(orders).where(inArray(orders.sessionId, sessionIds)) : [];
  const orderIds = orderRows.map(row => row.orderId);
  const items = orderIds.length ? await db.select({ orderItemId: orderItems.orderItemId, orderId: orderItems.orderId,
    itemType: orderItems.itemType, qty: orderItems.qty, unitPrice: orderItems.unitPrice, status: orderItems.status })
    .from(orderItems).where(inArray(orderItems.orderId, orderIds)) : [];
  const itemIds = items.map(row => row.orderItemId);
  const cancels = itemIds.length ? await db.select({ orderItemId: orderItemCancellations.orderItemId,
    qty: orderItemCancellations.cancelledQty }).from(orderItemCancellations)
    .where(inArray(orderItemCancellations.orderItemId, itemIds)) : [];
  const cancelled = new Map<number, number>();
  for (const row of cancels) cancelled.set(row.orderItemId, (cancelled.get(row.orderItemId) ?? 0) + row.qty);
  const sessionByOrder = new Map(orderRows.map(row => [row.orderId, row.sessionId]));
  const statusByOrder = new Map(orderRows.map(row => [row.orderId, row.status]));
  const grossBySessionId = new Map<number, number>();
  for (const item of items) {
    const sessionId = sessionByOrder.get(item.orderId);
    const qty = statusByOrder.get(item.orderId) === "CANCELLED" || item.status === "CANCELLED"
      ? 0 : Math.max(0, item.qty - (cancelled.get(item.orderItemId) ?? 0));
    if (sessionId && qty > 0) grossBySessionId.set(sessionId,
      (grossBySessionId.get(sessionId) ?? 0) + (item.itemType === "SERVICE" ? 0 : Number(item.unitPrice) * qty));
  }
  const sessionIdsWithTable = sessions.map(row => row.sessionId);
  const [discountRows, allocations] = sessionIdsWithTable.length ? await Promise.all([
    db.select({ sessionId: tableSessionDiscounts.sessionId, amount: tableSessionDiscounts.discountAmount })
      .from(tableSessionDiscounts).where(inArray(tableSessionDiscounts.sessionId, sessionIdsWithTable)),
    db.select({ sessionId: paymentSessionAllocations.sessionId, amount: paymentSessionAllocations.appliedAmount })
      .from(paymentSessionAllocations).innerJoin(payments, eq(paymentSessionAllocations.paymentId, payments.paymentId))
      .where(and(inArray(paymentSessionAllocations.sessionId, sessionIdsWithTable), eq(payments.status, "APPROVED"))),
  ]) : [[], []];
  const discountBySessionId = new Map<number, number>();
  for (const row of discountRows) discountBySessionId.set(row.sessionId,
    (discountBySessionId.get(row.sessionId) ?? 0) + Number(row.amount));
  const prepaidBySessionId = new Map<number, number>();
  for (const row of allocations) prepaidBySessionId.set(row.sessionId,
    (prepaidBySessionId.get(row.sessionId) ?? 0) + Number(row.amount));

  const sessionByTable = new Map(sessions.map(row => [row.tableId!, row]));
  const mergedSources = new Map<number, typeof sessions>();
  for (const merge of merges) {
    const source = sessions.find(session => session.sessionId === merge.sourceSessionId);
    if (source) mergedSources.set(merge.destinationTableId,
      [...(mergedSources.get(merge.destinationTableId) ?? []), source]);
  }
  const sourceSessionIds = new Set(merges.map(row => row.sourceSessionId));
  const financials = calculateTableFinancials({
    tableScopes: layouts.flatMap(table => {
      const main = sessionByTable.get(table.tableId);
      if (!main || sourceSessionIds.has(main.sessionId)) return [];
      return [{ tableId: table.tableId, sessionIds: [main.sessionId,
        ...(mergedSources.get(table.tableId) ?? []).map(source => source.sessionId)] }];
    }), grossBySessionId, discountBySessionId, prepaidBySessionId,
  });
  const tableNoById = new Map(layouts.map(table => [table.tableId, table.tableNo]));
  const visible = layouts.map(table => {
    const session = sessionByTable.get(table.tableId);
    const isMergedSource = Boolean(session && sourceSessionIds.has(session.sessionId));
    const sources = mergedSources.get(table.tableId) ?? [];
    const sourceMerge = session ? merges.find(merge => merge.sourceSessionId === session.sessionId) : undefined;
    const summary = financials.get(table.tableId);
    return {
      ...table,
      sessionId: isMergedSource ? null : session?.sessionId ?? null,
      hasQrOrder: !isMergedSource && session ? sessionsWithQrOrders.has(session.sessionId) : false,
      isMergedSource,
      mergedIntoTableNo: sourceMerge ? tableNoById.get(sourceMerge.destinationTableId) ?? null : null,
      personCount: isMergedSource ? null : session?.personCount ?? null,
      babyCount: isMergedSource ? null : session?.babyCount ?? null,
      openedAt: isMergedSource ? null : session?.openedAt ?? null,
      mergedSourceTableNos: sources.map(source => tableNoById.get(source.tableId!) ?? ""),
      relatedSessionIds: isMergedSource ? [] : [session?.sessionId, ...sources.map(source => source.sessionId)]
        .filter((id): id is number => id !== undefined),
      amountDue: summary?.remaining ?? 0,
    };
  });
  return { tables: includeHidden ? visible : visible.filter(table => table.isVisible), qrOrdersAvailable: false };
}
