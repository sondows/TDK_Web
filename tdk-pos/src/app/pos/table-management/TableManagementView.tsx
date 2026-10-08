import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db, pool } from "@/db";
import { diningTables, orderItemCancellations, orderItems, orders, paymentSessionAllocations, payments, tableSessionDiscounts, tableSessionMerges, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { resolveTableLayout } from "@/lib/table-layout";
import { calculateTableFinancials } from "@/lib/table-session-financials";
import { toQrLanguageDisplayCode } from "@/lib/qr-language-code";
import TableManagementClient from "./TableManagementClient";
import type { RowDataPacket } from "mysql2";

type QrOrderLocaleRow = RowDataPacket & { sessionId: number; languageCode: string | null };

export default async function TableManagementView({ modal = false, closeToPos = false }: { modal?: boolean; closeToPos?: boolean }) {
  const [staff, loginMode] = await Promise.all([getCurrentStaff(), getPosLoginMode()]);
  if (!staff && loginMode !== "SHARED") redirect("/login");

  const [tableLayouts, openSessions, activeMerges] = await Promise.all([db.select({
    tableId: diningTables.tableId,
    tableNo: diningTables.tableNo,
    tableName: diningTables.tableName,
    capacity: diningTables.capacity,
    isActive: diningTables.isActive,
    positionX: diningTables.positionX,
    positionY: diningTables.positionY,
    layoutWidth: diningTables.layoutWidth,
    layoutHeight: diningTables.layoutHeight,
    rotation: diningTables.rotation,
  }).from(diningTables).where(eq(diningTables.isActive, 1)).orderBy(diningTables.sortOrder),
  db.select({ sessionId: tableSessions.sessionId, tableId: tableSessions.tableId, groupId: tableSessions.groupId, personCount: tableSessions.personCount, babyCount: tableSessions.babyCount, openedAtEpoch: sql<number>`UNIX_TIMESTAMP(${tableSessions.openedAt})` }).from(tableSessions).where(eq(tableSessions.status, "OPEN")),
  db.select({ mergeId: tableSessionMerges.mergeId, sourceSessionId: tableSessionMerges.sourceSessionId, sourceTableId: tableSessionMerges.sourceTableId, destinationSessionId: tableSessionMerges.destinationSessionId, destinationTableId: tableSessionMerges.destinationTableId }).from(tableSessionMerges).where(eq(tableSessionMerges.status, "ACTIVE"))]);
  const openSessionIds = new Set(openSessions.map(session => session.sessionId));
  const activeOpenMerges = activeMerges.filter(merge => openSessionIds.has(merge.sourceSessionId) && openSessionIds.has(merge.destinationSessionId));
  const mergedSourceSessionIds = new Set(activeOpenMerges.map(merge => merge.sourceSessionId));
  const visibleSessionByTableId = new Map(openSessions.filter(session => !mergedSourceSessionIds.has(session.sessionId)).map(session => [session.tableId, session]));
  const tableNoById = new Map(tableLayouts.map(table => [table.tableId, table.tableNo]));
  const mergedSourceNosByDestinationId = new Map<number, string[]>();
  const activeMergeSourcesByDestinationId = new Map<number, Array<{ mergeId: number; sourceTableNo: string }>>();
  activeOpenMerges.forEach(merge => mergedSourceNosByDestinationId.set(merge.destinationTableId, [...(mergedSourceNosByDestinationId.get(merge.destinationTableId) ?? []), tableNoById.get(merge.sourceTableId) ?? String(merge.sourceTableId)]));
  activeOpenMerges.forEach(merge => activeMergeSourcesByDestinationId.set(merge.destinationTableId, [...(activeMergeSourcesByDestinationId.get(merge.destinationTableId) ?? []), { mergeId: merge.mergeId, sourceTableNo: tableNoById.get(merge.sourceTableId) ?? String(merge.sourceTableId) }]));
  const tables = tableLayouts.map(table => ({ ...table, ...(visibleSessionByTableId.get(table.tableId) ?? { sessionId: null, groupId: null, personCount: 0, babyCount: 0, openedAtEpoch: null }), mergedSourceTableNos: (mergedSourceNosByDestinationId.get(table.tableId) ?? []).sort((a, b) => a.localeCompare(b, "ko", { numeric: true })), activeMergeSources: (activeMergeSourcesByDestinationId.get(table.tableId) ?? []).sort((a, b) => a.sourceTableNo.localeCompare(b.sourceTableNo, "ko", { numeric: true })) }));
  const sessionIds = openSessions.map(session => session.sessionId);
  const sessionOrders = sessionIds.length ? await db.select({ orderId: orders.orderId, sessionId: orders.sessionId, status: orders.status }).from(orders).where(inArray(orders.sessionId, sessionIds)) : [];
  const orderIds = sessionOrders.map(order => order.orderId);
  const items = orderIds.length ? await db.select({ orderItemId: orderItems.orderItemId, orderId: orderItems.orderId, unitPrice: orderItems.unitPrice, itemType: orderItems.itemType, qty: orderItems.qty, status: orderItems.status }).from(orderItems).where(inArray(orderItems.orderId, orderIds)) : [];
  const itemIds = items.map(item => item.orderItemId);
  const cancellations = itemIds.length ? await db.select({ orderItemId: orderItemCancellations.orderItemId, cancelledQty: orderItemCancellations.cancelledQty }).from(orderItemCancellations).where(inArray(orderItemCancellations.orderItemId, itemIds)) : [];
  const cancelledByItem = new Map<number, number>();
  cancellations.forEach(cancellation => cancelledByItem.set(cancellation.orderItemId, (cancelledByItem.get(cancellation.orderItemId) ?? 0) + cancellation.cancelledQty));
  const sessionByOrder = new Map(sessionOrders.map(order => [order.orderId, order.sessionId]));
  const orderStatusById = new Map(sessionOrders.map(order => [order.orderId, order.status]));
  const amountDueBySession = new Map<number, number>();
  items.forEach(item => {
    const sessionId = sessionByOrder.get(item.orderId);
    const effectiveQty = item.status === "CANCELLED" || orderStatusById.get(item.orderId) === "CANCELLED" ? 0 : Math.max(0, item.qty - (cancelledByItem.get(item.orderItemId) ?? 0));
    if (sessionId && effectiveQty > 0) amountDueBySession.set(sessionId, (amountDueBySession.get(sessionId) ?? 0) + (item.itemType === "SERVICE" ? 0 : Number(item.unitPrice)) * effectiveQty);
  });
  const discounts = sessionIds.length ? await db.select({ sessionId: tableSessionDiscounts.sessionId, amount: tableSessionDiscounts.discountAmount }).from(tableSessionDiscounts).where(inArray(tableSessionDiscounts.sessionId, sessionIds)) : [];
  const discountBySessionId = new Map<number, number>();
  discounts.forEach(discount => discountBySessionId.set(discount.sessionId, (discountBySessionId.get(discount.sessionId) ?? 0) + Number(discount.amount)));
  const allocations = sessionIds.length ? await db.select({ sessionId: paymentSessionAllocations.sessionId, amount: paymentSessionAllocations.appliedAmount }).from(paymentSessionAllocations).innerJoin(payments, eq(paymentSessionAllocations.paymentId, payments.paymentId)).where(and(inArray(paymentSessionAllocations.sessionId, sessionIds), eq(payments.status, "APPROVED"))) : [];
  const prepaidBySessionId = new Map<number, number>();
  allocations.forEach(allocation => prepaidBySessionId.set(allocation.sessionId, (prepaidBySessionId.get(allocation.sessionId) ?? 0) + Number(allocation.amount)));
  const financialsByTableId = calculateTableFinancials({
    tableScopes: tables.filter(table => table.sessionId !== null).map(table => ({ tableId: table.tableId, sessionIds: [table.sessionId!, ...activeOpenMerges.filter(merge => merge.destinationTableId === table.tableId).map(merge => merge.sourceSessionId)] })),
    grossBySessionId: amountDueBySession,
    discountBySessionId,
    prepaidBySessionId,
  });
  const qrRows: QrOrderLocaleRow[] = sessionIds.length
    ? (await pool.query<QrOrderLocaleRow[]>(`SELECT qs.session_id AS sessionId, qs.language_code AS languageCode
        FROM qr_orders qo
        INNER JOIN qr_sessions qs ON qs.qr_session_id = qo.qr_session_id
        WHERE qs.session_id IN (?)
        ORDER BY qo.ordered_at DESC, qo.qr_order_id DESC`, [sessionIds]))[0]
    : [];
  const qrBySessionId = new Map<number, string | null>();
  qrRows.forEach(row => { if (!qrBySessionId.has(row.sessionId)) qrBySessionId.set(row.sessionId, toQrLanguageDisplayCode(row.languageCode)); });

  return <TableManagementClient closeToPos={closeToPos} modal={modal} tables={tables.map((table, index) => ({
    ...table,
    ...resolveTableLayout({ positionX: table.positionX === null ? undefined : Number(table.positionX), positionY: table.positionY === null ? undefined : Number(table.positionY), layoutWidth: table.layoutWidth === null ? undefined : Number(table.layoutWidth), layoutHeight: table.layoutHeight === null ? undefined : Number(table.layoutHeight), rotation: table.rotation }, index),
    sessionId: table.sessionId,
    personCount: table.personCount ?? 0,
    babyCount: table.babyCount ?? 0,
    openedAt: table.openedAtEpoch === null ? null : new Date(Number(table.openedAtEpoch) * 1000).toISOString(),
    amountDue: table.sessionId ? financialsByTableId.get(table.tableId)?.remaining ?? 0 : 0,
    prepaidAmount: table.sessionId ? financialsByTableId.get(table.tableId)?.prepaid ?? 0 : 0,
    hasQrOrder: table.sessionId !== null && qrBySessionId.has(table.sessionId),
    qrLanguageCode: table.sessionId === null ? null : qrBySessionId.get(table.sessionId) ?? null,
  }))} />;
}
