import { and, eq, inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { checkoutItems, checkouts, diningTables, discountRules, menuCategories, menuImages, menuModifierGroups, menus, modifierGroups, modifierOptions, orderItemCancellations, orderItemOptions, orderItems, orders, payments, systemSettings, tableSessionDiscounts, tableSessionMerges, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import PosShell from "./PosShell";
import { resolveTableLayout } from "@/lib/table-layout";

export default async function PosPage() {
  const authenticatedStaff = await getCurrentStaff();
  const loginMode = await getPosLoginMode();
  if (!authenticatedStaff && loginMode !== "SHARED") redirect("/login");
  const currentStaff = authenticatedStaff ?? { name: "매장 공용", role: "SHARED" as const };
  const [tableLayouts, openSessions, activeMerges, activeMenus, activeCategories, activeMenuModifiers, idleResetSetting, quickDiscounts] = await Promise.all([
    db.select({ tableId: diningTables.tableId, tableNo: diningTables.tableNo, tableName: diningTables.tableName, capacity: diningTables.capacity, positionX: diningTables.positionX, positionY: diningTables.positionY, layoutWidth: diningTables.layoutWidth, layoutHeight: diningTables.layoutHeight, rotation: diningTables.rotation }).from(diningTables).where(eq(diningTables.isActive, 1)).orderBy(diningTables.sortOrder),
    db.select({ sessionId: tableSessions.sessionId, tableId: tableSessions.tableId, groupId: tableSessions.groupId, personCount: tableSessions.personCount, babyCount: tableSessions.babyCount, openedAtEpoch: sql<number>`UNIX_TIMESTAMP(${tableSessions.openedAt})` }).from(tableSessions).where(eq(tableSessions.status, "OPEN")),
    db.select({ sourceSessionId: tableSessionMerges.sourceSessionId, sourceTableId: tableSessionMerges.sourceTableId, destinationSessionId: tableSessionMerges.destinationSessionId, destinationTableId: tableSessionMerges.destinationTableId }).from(tableSessionMerges).where(eq(tableSessionMerges.status, "ACTIVE")),
    db.select({ menuId: menus.menuId, categoryId: menus.categoryId, name: menus.posName, price: menus.price, countsAsPerson: menus.countsAsPerson, categoryName: menuCategories.posName, imageUrl: menuImages.imageUrl }).from(menus).leftJoin(menuCategories, eq(menus.categoryId, menuCategories.categoryId)).leftJoin(menuImages, and(eq(menuImages.menuId, menus.menuId), eq(menuImages.imageType, "POS"), eq(menuImages.isActive, 1))).where(eq(menus.isActive, 1)).orderBy(menuCategories.sortOrder, menus.sortOrder),
    db.select({ categoryId: menuCategories.categoryId, name: menuCategories.posName }).from(menuCategories).where(eq(menuCategories.isActive, 1)).orderBy(menuCategories.sortOrder),
    db.select({ menuId: menuModifierGroups.menuId, modifierGroupId: modifierGroups.modifierGroupId, groupName: modifierGroups.posName, groupSortOrder: modifierGroups.sortOrder, modifierOptionId: modifierOptions.modifierOptionId, optionName: modifierOptions.posName, priceDelta: modifierOptions.priceDelta, optionSortOrder: modifierOptions.sortOrder }).from(menuModifierGroups).innerJoin(modifierGroups, and(eq(menuModifierGroups.modifierGroupId, modifierGroups.modifierGroupId), eq(modifierGroups.isActive, 1))).innerJoin(modifierOptions, and(eq(modifierGroups.modifierGroupId, modifierOptions.modifierGroupId), eq(modifierOptions.isActive, 1))).orderBy(menuModifierGroups.menuId, menuModifierGroups.sortOrder, modifierGroups.sortOrder, modifierOptions.sortOrder),
    db.select({ value: systemSettings.settingValue }).from(systemSettings).where(eq(systemSettings.settingKey, "pos_idle_reset_seconds")).limit(1),
    db.select({ ruleId: discountRules.discountRuleId, slot: discountRules.posPresetSlot, title: discountRules.discountName, type: discountRules.discountType, value: discountRules.discountValue }).from(discountRules).where(and(inArray(discountRules.posPresetSlot, [1, 2, 3, 4]), eq(discountRules.isActive, 1))).orderBy(discountRules.posPresetSlot),
  ]);
  const mergedSourceSessionIds = new Set(activeMerges.map(merge => merge.sourceSessionId));
  const visibleSessionByTableId = new Map(openSessions.filter(session => !mergedSourceSessionIds.has(session.sessionId)).map(session => [session.tableId, session]));
  const tableNoById = new Map(tableLayouts.map(table => [table.tableId, table.tableNo]));
  const mergedSourceNosByDestinationId = new Map<number, string[]>();
  const mergedSourceSessionIdsByDestinationId = new Map<number, number[]>();
  activeMerges.forEach(merge => mergedSourceNosByDestinationId.set(merge.destinationTableId, [...(mergedSourceNosByDestinationId.get(merge.destinationTableId) ?? []), tableNoById.get(merge.sourceTableId) ?? String(merge.sourceTableId)]));
  activeMerges.forEach(merge => mergedSourceSessionIdsByDestinationId.set(merge.destinationTableId, [...(mergedSourceSessionIdsByDestinationId.get(merge.destinationTableId) ?? []), merge.sourceSessionId]));
  const tables = tableLayouts.map(table => ({ ...table, ...(visibleSessionByTableId.get(table.tableId) ?? { sessionId: null, groupId: null, personCount: null, babyCount: null, openedAtEpoch: null }), mergedSourceTableNos: (mergedSourceNosByDestinationId.get(table.tableId) ?? []).sort((a, b) => a.localeCompare(b, "ko", { numeric: true })), mergedSourceSessionIds: [...new Set(mergedSourceSessionIdsByDestinationId.get(table.tableId) ?? [])] }));
  const sessionIds = openSessions.map(session => session.sessionId);
  const discounts = sessionIds.length ? await db.select({ sessionId: tableSessionDiscounts.sessionId, discountType: tableSessionDiscounts.discountType, label: tableSessionDiscounts.label, discountAmount: tableSessionDiscounts.discountAmount, discountRate: tableSessionDiscounts.discountRate }).from(tableSessionDiscounts).where(inArray(tableSessionDiscounts.sessionId, sessionIds)) : [];
  const sessionOrders = sessionIds.length ? await db.select({ sessionId: orders.sessionId, orderId: orders.orderId, orderedAt: orders.orderedAt, status: orders.status }).from(orders).where(inArray(orders.sessionId, sessionIds)) : [];
  const orderIds = sessionOrders.map((order) => order.orderId);
  const items = orderIds.length ? await db.select({ orderItemId: orderItems.orderItemId, orderId: orderItems.orderId, menuId: orderItems.menuId, itemName: orderItems.itemName, qty: orderItems.qty, unitPrice: orderItems.unitPrice, totalAmount: orderItems.totalAmount, status: orderItems.status }).from(orderItems).where(inArray(orderItems.orderId, orderIds)) : [];
  const itemIds = items.map(item => item.orderItemId);
  const itemOptions = itemIds.length ? await db.select({ orderItemId: orderItemOptions.orderItemId, modifierOptionId: orderItemOptions.modifierOptionId, optionName: orderItemOptions.optionName, qty: orderItemOptions.qty, unitPrice: orderItemOptions.unitPrice }).from(orderItemOptions).where(inArray(orderItemOptions.orderItemId, itemIds)) : [];
  const cancellations = itemIds.length ? await db.select({ cancellationId: orderItemCancellations.cancellationId, orderItemId: orderItemCancellations.orderItemId, cancelledQty: orderItemCancellations.cancelledQty, cancelledAmount: orderItemCancellations.cancelledAmount, cancellationReason: orderItemCancellations.cancellationReason, cancelledAt: orderItemCancellations.cancelledAt, cancelledByStaffId: orderItemCancellations.cancelledByStaffId }).from(orderItemCancellations).where(inArray(orderItemCancellations.orderItemId, itemIds)).orderBy(orderItemCancellations.cancelledAt) : [];
  const orderSessionById = new Map(sessionOrders.map((order) => [order.orderId, order.sessionId]));
  const orderStatusById = new Map(sessionOrders.map((order) => [order.orderId, order.status]));
  const orderIdByItemId = new Map(items.map((item) => [item.orderItemId, item.orderId]));
  const checkoutLinks = itemIds.length ? await db.select({ checkoutId: checkoutItems.checkoutId, checkoutStatus: checkouts.status, orderItemId: checkoutItems.orderItemId }).from(checkoutItems).innerJoin(checkouts, eq(checkoutItems.checkoutId, checkouts.checkoutId)).where(inArray(checkoutItems.orderItemId, itemIds)) : [];
  const activeCheckoutIds = [...new Set(checkoutLinks.filter(link => link.checkoutStatus === "OPEN" || link.checkoutStatus === "PARTIALLY_PAID").map(link => link.checkoutId))];
  const approvedPayments = activeCheckoutIds.length ? await db.select({ checkoutId: payments.checkoutId, amount: payments.amount }).from(payments).where(and(inArray(payments.checkoutId, activeCheckoutIds), eq(payments.status, "APPROVED"))) : [];
  const amountDueBySession = new Map<number, number>();
  const cancellationsByItem = new Map<number, typeof cancellations>(); cancellations.forEach(cancellation => cancellationsByItem.set(cancellation.orderItemId, [...(cancellationsByItem.get(cancellation.orderItemId) ?? []), cancellation]));
  const optionsByItem = new Map<number, typeof itemOptions>(); itemOptions.forEach(option => optionsByItem.set(option.orderItemId, [...(optionsByItem.get(option.orderItemId) ?? []), option]));
  const orderDetails = sessionOrders.map(order => ({ orderId: order.orderId, sessionId: order.sessionId, orderedAt: order.orderedAt.toISOString(), status: order.status, items: items.filter(item => item.orderId === order.orderId).map(item => { const itemCancellations = cancellationsByItem.get(item.orderItemId) ?? []; const cancelledQty = itemCancellations.reduce((sum, cancellation) => sum + cancellation.cancelledQty, 0); return { ...item, cancelledQty, effectiveQty: order.status === "CANCELLED" || item.status === "CANCELLED" ? 0 : Math.max(0, item.qty - cancelledQty), options: (optionsByItem.get(item.orderItemId) ?? []).map(option => ({ ...option })), cancellations: itemCancellations.map(cancellation => ({ ...cancellation, cancelledAt: cancellation.cancelledAt.toISOString() })) }; }) }));
  items.forEach((item) => {
    const sessionId = orderSessionById.get(item.orderId);
    const effectiveQty = orderStatusById.get(item.orderId) === "CANCELLED" || item.status === "CANCELLED" ? 0 : Math.max(0, item.qty - (cancellationsByItem.get(item.orderItemId) ?? []).reduce((sum, cancellation) => sum + cancellation.cancelledQty, 0));
    if (sessionId && effectiveQty > 0) amountDueBySession.set(sessionId, (amountDueBySession.get(sessionId) ?? 0) + Number(item.unitPrice) * effectiveQty);
  });
  const physicalAmountByTableId = new Map<number, number>();
  tables.forEach(table => {
    if (!table.sessionId) return;
    const sessionIds = new Set([table.sessionId, ...(table.mergedSourceSessionIds ?? [])]);
    physicalAmountByTableId.set(table.tableId, Math.max(0, [...sessionIds].reduce((sum, sessionId) => sum + (amountDueBySession.get(sessionId) ?? 0), 0) - discounts.filter(discount => sessionIds.has(discount.sessionId)).reduce((sum, discount) => sum + Number(discount.discountAmount), 0)));
  });
  const checkoutIdsBySessionId = new Map<number, Set<number>>();
  checkoutLinks.forEach((link) => {
    if (link.checkoutStatus !== "OPEN" && link.checkoutStatus !== "PARTIALLY_PAID") return;
    const orderId = orderIdByItemId.get(link.orderItemId);
    const sessionId = orderId === undefined ? undefined : orderSessionById.get(orderId);
    if (sessionId === undefined) return;
    const ids = checkoutIdsBySessionId.get(sessionId) ?? new Set<number>();
    ids.add(link.checkoutId);
    checkoutIdsBySessionId.set(sessionId, ids);
  });
  const prepaidByCheckoutId = new Map<number, number>();
  approvedPayments.forEach(payment => prepaidByCheckoutId.set(payment.checkoutId, (prepaidByCheckoutId.get(payment.checkoutId) ?? 0) + Number(payment.amount)));
  const paymentScopeSessionIdsByTableId = new Map<number, Set<number>>();
  const prepaidByTableId = new Map<number, number>();
  tables.forEach((table) => {
    if (!table.sessionId) return;
    const paymentScopeSessionIds = new Set([table.sessionId, ...table.mergedSourceSessionIds]);
    paymentScopeSessionIdsByTableId.set(table.tableId, paymentScopeSessionIds);
    const checkoutIds = new Set<number>();
    paymentScopeSessionIds.forEach(sessionId => checkoutIdsBySessionId.get(sessionId)?.forEach(checkoutId => checkoutIds.add(checkoutId)));
    prepaidByTableId.set(table.tableId, [...checkoutIds].reduce((sum, checkoutId) => sum + (prepaidByCheckoutId.get(checkoutId) ?? 0), 0));
  });
  const paymentTotalByTableId = new Map<number, number>();
  tables.forEach((table) => {
    const paymentScopeSessionIds = paymentScopeSessionIdsByTableId.get(table.tableId);
    if (!paymentScopeSessionIds) return;
    const gross = [...paymentScopeSessionIds].reduce((sum, sessionId) => sum + (amountDueBySession.get(sessionId) ?? 0), 0);
    const discount = discounts.filter(entry => paymentScopeSessionIds.has(entry.sessionId)).reduce((sum, entry) => sum + Number(entry.discountAmount), 0);
    paymentTotalByTableId.set(table.tableId, Math.max(0, gross - discount));
  });
  const idleResetSeconds = Math.max(0, Number(idleResetSetting[0]?.value ?? 60));
  return <PosShell discounts={discounts} idleResetSeconds={Number.isInteger(idleResetSeconds) ? idleResetSeconds : 0} quickDiscounts={quickDiscounts.filter(rule => rule.slot !== null && (rule.type === "AMOUNT" || rule.type === "RATE")).map(rule => ({ ruleId: rule.ruleId, slot: rule.slot!, title: rule.title, type: rule.type === "RATE" ? "PERCENT" as const : "AMOUNT" as const, value: Number(rule.value) }))} staffName={currentStaff.name} staffRole={currentStaff.role} tables={tables.map((table, index) => ({ ...table, ...resolveTableLayout({ positionX: table.positionX === null ? undefined : Number(table.positionX), positionY: table.positionY === null ? undefined : Number(table.positionY), layoutWidth: table.layoutWidth === null ? undefined : Number(table.layoutWidth), layoutHeight: table.layoutHeight === null ? undefined : Number(table.layoutHeight), rotation: table.rotation }, index), amountDue: table.sessionId ? physicalAmountByTableId.get(table.tableId) ?? 0 : 0, prepaidAmount: table.sessionId ? prepaidByTableId.get(table.tableId) ?? 0 : 0, paymentTotal: table.sessionId ? paymentTotalByTableId.get(table.tableId) ?? 0 : 0, openedAt: table.openedAtEpoch === null ? null : new Date(Number(table.openedAtEpoch) * 1000).toISOString() }))} menus={activeMenus} categories={activeCategories} menuModifiers={activeMenuModifiers} orders={sessionOrders} orderItems={items} orderDetails={orderDetails} />;
}
