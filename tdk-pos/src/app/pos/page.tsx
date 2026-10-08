import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import type { RowDataPacket } from "mysql2";
import { redirect } from "next/navigation";
import { db, pool } from "@/db";
import { diningTables, discountRules, inventoryItems, menuCategories, menuComponents, menuImages, menuModifierGroups, menus, modifierGroups, modifierOptions, orderItemCancellations, orderItemOptions, orderItems, orders, paymentSessionAllocations, payments, systemSettings, tableSessionDiscounts, tableSessionMerges, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import PosShell from "./PosShell";
import { ensureRiceBusinessDay, RICE_ITEM_CODE } from "@/lib/rice-stock";
import { resolveTableLayout } from "@/lib/table-layout";
import { calculateTableFinancials, summarizeSessionFinancials } from "@/lib/table-session-financials";
import { toQrLanguageDisplayCode } from "@/lib/qr-language-code";

type QrOrderLocaleRow = RowDataPacket & { sessionId: number; languageCode: string | null };

export default async function PosPage() {
  const authenticatedStaff = await getCurrentStaff();
  if (!authenticatedStaff) redirect("/login");
  const currentStaff = authenticatedStaff.staffCode === "000"
    ? { name: "매장 공용", role: "SHARED" as const }
    : authenticatedStaff;
  const componentMenu = alias(menus, "component_menu");
  const [tableLayouts, openSessions, activeMerges, activeMenus, activeCategories, activeMenuModifiers, idleResetSetting, quickDiscounts, activeMenuComponents] = await Promise.all([
    db.select({ tableId: diningTables.tableId, tableNo: diningTables.tableNo, tableName: diningTables.tableName, capacity: diningTables.capacity, positionX: diningTables.positionX, positionY: diningTables.positionY, layoutWidth: diningTables.layoutWidth, layoutHeight: diningTables.layoutHeight, rotation: diningTables.rotation }).from(diningTables).where(eq(diningTables.isActive, 1)).orderBy(diningTables.sortOrder),
    db.select({ sessionId: tableSessions.sessionId, tableId: tableSessions.tableId, groupId: tableSessions.groupId, personCount: tableSessions.personCount, babyCount: tableSessions.babyCount, openedAtEpoch: sql<number>`UNIX_TIMESTAMP(${tableSessions.openedAt})` }).from(tableSessions).where(eq(tableSessions.status, "OPEN")),
    db.select({ sourceSessionId: tableSessionMerges.sourceSessionId, sourceTableId: tableSessionMerges.sourceTableId, destinationSessionId: tableSessionMerges.destinationSessionId, destinationTableId: tableSessionMerges.destinationTableId }).from(tableSessionMerges).where(eq(tableSessionMerges.status, "ACTIVE")),
    db.select({ menuId: menus.menuId, categoryId: menus.categoryId, name: menus.posName, price: menus.price, countsAsPerson: menus.countsAsPerson, categoryName: menuCategories.posName, imageUrl: menuImages.imageUrl }).from(menus).leftJoin(menuCategories, eq(menus.categoryId, menuCategories.categoryId)).leftJoin(menuImages, and(eq(menuImages.menuId, menus.menuId), eq(menuImages.imageType, "POS"), eq(menuImages.isActive, 1))).where(eq(menus.isActive, 1)).orderBy(menuCategories.sortOrder, menus.sortOrder),
    db.select({ categoryId: menuCategories.categoryId, name: menuCategories.posName }).from(menuCategories).where(eq(menuCategories.isActive, 1)).orderBy(menuCategories.sortOrder),
    db.select({ menuId: menuModifierGroups.menuId, modifierGroupId: modifierGroups.modifierGroupId, groupName: modifierGroups.posName, groupSortOrder: modifierGroups.sortOrder, modifierOptionId: modifierOptions.modifierOptionId, optionName: modifierOptions.posName, priceDelta: modifierOptions.priceDelta, optionSortOrder: modifierOptions.sortOrder }).from(menuModifierGroups).innerJoin(modifierGroups, and(eq(menuModifierGroups.modifierGroupId, modifierGroups.modifierGroupId), eq(modifierGroups.isActive, 1))).innerJoin(modifierOptions, and(eq(modifierGroups.modifierGroupId, modifierOptions.modifierGroupId), eq(modifierOptions.isActive, 1))).orderBy(menuModifierGroups.menuId, menuModifierGroups.sortOrder, modifierGroups.sortOrder, modifierOptions.sortOrder),
    db.select({ value: systemSettings.settingValue }).from(systemSettings).where(eq(systemSettings.settingKey, "pos_idle_reset_seconds")).limit(1),
    db.select({ ruleId: discountRules.discountRuleId, slot: discountRules.posPresetSlot, title: discountRules.discountName, type: discountRules.discountType, value: discountRules.discountValue }).from(discountRules).where(and(inArray(discountRules.posPresetSlot, [1, 2, 3, 4]), eq(discountRules.isActive, 1))).orderBy(discountRules.posPresetSlot),
    db.select({ menuComponentId: menuComponents.menuComponentId, menuId: menuComponents.parentMenuId, componentMenuId: componentMenu.menuId, itemName: componentMenu.posName, price: componentMenu.price, quantity: menuComponents.qtyPerUnit, printOnKitchen: menuComponents.printOnKitchen, printOnReceipt: menuComponents.printOnReceipt, sortOrder: menuComponents.sortOrder }).from(menuComponents).innerJoin(componentMenu, and(eq(componentMenu.menuId, menuComponents.componentMenuId), eq(componentMenu.isActive, 1))).orderBy(menuComponents.parentMenuId, menuComponents.sortOrder),
  ]);
  const openSessionIds = new Set(openSessions.map(session => session.sessionId));
  const activeOpenMerges = activeMerges.filter(merge => openSessionIds.has(merge.sourceSessionId) && openSessionIds.has(merge.destinationSessionId));
  const mergedSourceSessionIds = new Set(activeOpenMerges.map(merge => merge.sourceSessionId));
  const visibleSessionByTableId = new Map(openSessions.filter(session => !mergedSourceSessionIds.has(session.sessionId)).map(session => [session.tableId, session]));
  const tableNoById = new Map(tableLayouts.map(table => [table.tableId, table.tableNo]));
  const mergedSourceNosByDestinationId = new Map<number, string[]>();
  const mergedSourceSessionIdsByDestinationId = new Map<number, number[]>();
  activeOpenMerges.forEach(merge => mergedSourceNosByDestinationId.set(merge.destinationTableId, [...(mergedSourceNosByDestinationId.get(merge.destinationTableId) ?? []), tableNoById.get(merge.sourceTableId) ?? String(merge.sourceTableId)]));
  activeOpenMerges.forEach(merge => mergedSourceSessionIdsByDestinationId.set(merge.destinationTableId, [...(mergedSourceSessionIdsByDestinationId.get(merge.destinationTableId) ?? []), merge.sourceSessionId]));
  const tables = tableLayouts.map(table => ({ ...table, ...(visibleSessionByTableId.get(table.tableId) ?? { sessionId: null, groupId: null, personCount: null, babyCount: null, openedAtEpoch: null }), mergedSourceTableNos: (mergedSourceNosByDestinationId.get(table.tableId) ?? []).sort((a, b) => a.localeCompare(b, "ko", { numeric: true })), mergedSourceSessionIds: [...new Set(mergedSourceSessionIdsByDestinationId.get(table.tableId) ?? [])] }));
  const sessionIds = openSessions.map(session => session.sessionId);
  const qrOrderLocaleRows: QrOrderLocaleRow[] = sessionIds.length
    ? (await pool.query<QrOrderLocaleRow[]>(`SELECT qs.session_id AS sessionId, qs.language_code AS languageCode
        FROM qr_orders qo
        INNER JOIN qr_sessions qs ON qs.qr_session_id = qo.qr_session_id
        WHERE qs.session_id IN (?)
        ORDER BY qo.ordered_at DESC, qo.qr_order_id DESC`, [sessionIds]))[0]
    : [];
  const qrOrderLocaleBySessionId = new Map<number, string | null>();
  qrOrderLocaleRows.forEach(row => {
    if (!qrOrderLocaleBySessionId.has(row.sessionId)) qrOrderLocaleBySessionId.set(row.sessionId, toQrLanguageDisplayCode(row.languageCode));
  });
  const discounts = sessionIds.length ? await db.select({ sessionId: tableSessionDiscounts.sessionId, discountType: tableSessionDiscounts.discountType, label: tableSessionDiscounts.label, discountAmount: tableSessionDiscounts.discountAmount, discountRate: tableSessionDiscounts.discountRate }).from(tableSessionDiscounts).where(inArray(tableSessionDiscounts.sessionId, sessionIds)) : [];
  const paymentAllocations = sessionIds.length ? await db.select({ sessionId: paymentSessionAllocations.sessionId, amount: paymentSessionAllocations.appliedAmount }).from(paymentSessionAllocations).innerJoin(payments, eq(paymentSessionAllocations.paymentId, payments.paymentId)).where(and(inArray(paymentSessionAllocations.sessionId, sessionIds), eq(payments.status, "APPROVED"))) : [];
  const sessionOrders = sessionIds.length ? await db.select({ sessionId: orders.sessionId, orderId: orders.orderId, orderedAt: orders.orderedAt, status: orders.status }).from(orders).where(inArray(orders.sessionId, sessionIds)).orderBy(orders.orderId) : [];
  const orderIds = sessionOrders.map((order) => order.orderId);
  const items = orderIds.length ? await db.select({ orderItemId: orderItems.orderItemId, orderId: orderItems.orderId, menuId: orderItems.menuId, parentOrderItemId: orderItems.parentOrderItemId, itemType: orderItems.itemType, actualComponentQty: orderItems.actualComponentQty, itemName: orderItems.itemName, qty: orderItems.qty, unitPrice: orderItems.unitPrice, discountAmount: orderItems.discountAmount, totalAmount: orderItems.totalAmount, status: orderItems.status }).from(orderItems).where(inArray(orderItems.orderId, orderIds)).orderBy(orderItems.orderItemId) : [];
  const itemIds = items.map(item => item.orderItemId);
  const itemOptions = itemIds.length ? await db.select({ orderItemId: orderItemOptions.orderItemId, modifierOptionId: orderItemOptions.modifierOptionId, optionName: orderItemOptions.optionName, qty: orderItemOptions.qty, unitPrice: orderItemOptions.unitPrice }).from(orderItemOptions).where(inArray(orderItemOptions.orderItemId, itemIds)) : [];
  const cancellations = itemIds.length ? await db.select({ cancellationId: orderItemCancellations.cancellationId, orderItemId: orderItemCancellations.orderItemId, cancelledQty: orderItemCancellations.cancelledQty, cancelledAmount: orderItemCancellations.cancelledAmount, cancellationReason: orderItemCancellations.cancellationReason, cancelledAt: orderItemCancellations.cancelledAt, cancelledByStaffId: orderItemCancellations.cancelledByStaffId }).from(orderItemCancellations).where(inArray(orderItemCancellations.orderItemId, itemIds)).orderBy(orderItemCancellations.cancelledAt) : [];
  const orderSessionById = new Map(sessionOrders.map((order) => [order.orderId, order.sessionId]));
  const orderStatusById = new Map(sessionOrders.map((order) => [order.orderId, order.status]));
  const amountDueBySession = new Map<number, number>();
  const cancellationsByItem = new Map<number, typeof cancellations>(); cancellations.forEach(cancellation => cancellationsByItem.set(cancellation.orderItemId, [...(cancellationsByItem.get(cancellation.orderItemId) ?? []), cancellation]));
  const optionsByItem = new Map<number, typeof itemOptions>(); itemOptions.forEach(option => optionsByItem.set(option.orderItemId, [...(optionsByItem.get(option.orderItemId) ?? []), option]));
  const orderDetails = sessionOrders.map(order => ({ orderId: order.orderId, sessionId: order.sessionId, orderedAt: order.orderedAt.toISOString(), status: order.status, items: items.filter(item => item.orderId === order.orderId).map(item => { const itemCancellations = cancellationsByItem.get(item.orderItemId) ?? []; const cancelledQty = itemCancellations.reduce((sum, cancellation) => sum + cancellation.cancelledQty, 0); const actualQty = item.actualComponentQty ?? item.qty; return { ...item, cancelledQty, effectiveQty: order.status === "CANCELLED" || item.status === "CANCELLED" ? 0 : Math.max(0, actualQty - cancelledQty), options: (optionsByItem.get(item.orderItemId) ?? []).map(option => ({ ...option })), cancellations: itemCancellations.map(cancellation => ({ ...cancellation, cancelledAt: cancellation.cancelledAt.toISOString() })) }; }) }));
  items.forEach((item) => {
    const sessionId = orderSessionById.get(item.orderId);
    const effectiveQty = orderStatusById.get(item.orderId) === "CANCELLED" || item.status === "CANCELLED" ? 0 : Math.max(0, item.qty - (cancellationsByItem.get(item.orderItemId) ?? []).reduce((sum, cancellation) => sum + cancellation.cancelledQty, 0));
    if (sessionId && effectiveQty > 0) amountDueBySession.set(sessionId, (amountDueBySession.get(sessionId) ?? 0) + (item.itemType === "SERVICE" ? 0 : Number(item.unitPrice) * effectiveQty));
  });
  const prepaidBySessionId = new Map<number, number>();
  paymentAllocations.forEach(allocation => prepaidBySessionId.set(allocation.sessionId, (prepaidBySessionId.get(allocation.sessionId) ?? 0) + Number(allocation.amount)));
  const discountBySessionId = new Map<number, number>();
  discounts.forEach(discount => discountBySessionId.set(discount.sessionId, (discountBySessionId.get(discount.sessionId) ?? 0) + Number(discount.discountAmount)));
  const tableFinancials = calculateTableFinancials({
    tableScopes: tables.filter(table => table.sessionId !== null).map(table => ({ tableId: table.tableId, sessionIds: [table.sessionId!, ...table.mergedSourceSessionIds] })),
    grossBySessionId: amountDueBySession,
    discountBySessionId,
    prepaidBySessionId,
  });
  const sessionFinancials = openSessions.map(({ sessionId }) => ({
    sessionId,
    ...summarizeSessionFinancials({ sessionIds: [sessionId], grossBySessionId: amountDueBySession, discountBySessionId, prepaidBySessionId }),
  }));
  const [riceItem] = await db.select({ id: inventoryItems.inventoryItemId }).from(inventoryItems).where(and(eq(inventoryItems.itemCode, RICE_ITEM_CODE), eq(inventoryItems.isActive, 1))).limit(1);
  const riceCurrentQty = riceItem ? await db.transaction(tx => ensureRiceBusinessDay(tx)) : null;
  const idleResetSeconds = Math.max(0, Number(idleResetSetting[0]?.value ?? 60));
  return <PosShell riceCurrentQty={riceCurrentQty} sessionFinancials={sessionFinancials} discounts={discounts} idleResetSeconds={Number.isInteger(idleResetSeconds) ? idleResetSeconds : 0} quickDiscounts={quickDiscounts.filter(rule => rule.slot !== null && (rule.type === "AMOUNT" || rule.type === "RATE")).map(rule => ({ ruleId: rule.ruleId, slot: rule.slot!, title: rule.title, type: rule.type === "RATE" ? "PERCENT" as const : "AMOUNT" as const, value: Number(rule.value) }))} staffName={currentStaff.name} staffRole={currentStaff.role} tables={tables.map((table, index) => { const financials = tableFinancials.get(table.tableId); return { ...table, ...resolveTableLayout({ positionX: table.positionX === null ? undefined : Number(table.positionX), positionY: table.positionY === null ? undefined : Number(table.positionY), layoutWidth: table.layoutWidth === null ? undefined : Number(table.layoutWidth), layoutHeight: table.layoutHeight === null ? undefined : Number(table.layoutHeight), rotation: table.rotation }, index), amountDue: table.sessionId ? financials?.remaining ?? 0 : 0, prepaidAmount: table.sessionId ? financials?.prepaid ?? 0 : 0, paymentTotal: table.sessionId ? financials?.total ?? 0 : 0, hasQrOrder: table.sessionId !== null && qrOrderLocaleBySessionId.has(table.sessionId), qrLanguageCode: table.sessionId === null ? null : qrOrderLocaleBySessionId.get(table.sessionId) ?? null, openedAt: table.openedAtEpoch === null ? null : new Date(Number(table.openedAtEpoch) * 1000).toISOString() }; })} menus={activeMenus} menuComponents={activeMenuComponents} categories={activeCategories} menuModifiers={activeMenuModifiers} orders={sessionOrders} orderItems={items} orderDetails={orderDetails} />;
}
