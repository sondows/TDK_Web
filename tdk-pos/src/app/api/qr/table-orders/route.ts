import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { RowDataPacket } from "mysql2/promise";
import { db, pool } from "@/db";
import { diningTables, menuCategories, menus, modifierGroups, modifierOptions, orderItemCancellations, orderItemOptions, orderItems, orders as posOrderTable, paymentSessionAllocations, payments, qrCodes, qrOrderAuthAttempts, qrOrderItemOptions, qrOrderItems, qrOrders, qrSessions, qrTableLinks, tableSessionDiscounts, tableSessions } from "@/db/schema";
import { isSameOriginQrRequest } from "@/lib/qr-visit-session";
import { classifyQrOrderRequestFailure, isQrOrderAuthRuntimeEnabled, resolveQrOrderRequest } from "@/lib/qr-order-auth";
import { qrOrderAuthCartFingerprint } from "@/lib/qr-order-auth-attempt-policy";
import { createQrTableOrderClaim, getQrTableOrderClaim } from "@/lib/qr-table-order-claims";
import { enrichQrCatalog, qrWaitCartTotal, validateQrWaitCart } from "@/lib/qr-wait-order-data";
import { loadQrMenuCatalog } from "@/lib/qr-menu-catalog";
import { isQrCookingProgressMenu } from "@/lib/qr-cooking-progress";
import { isQrMenuAddonGroupName } from "@/lib/qr-menu-addon-model";
import { buildQrConfirmedOrderSummary } from "@/lib/qr-confirmed-order-summary";
import { buildOrderSummaryRows } from "@/lib/pos-order-summary-rows";

export const dynamic = "force-dynamic";

type StandardItemRow = RowDataPacket & { orderId: number; orderItemId: number; menuId: number };
type KdsTaskRow = RowDataPacket & { orderId: number; memberItems: string; kind: string; status: string; postCookTimerMinutes: number | null; postCookTimerStartedAtMs: number | string | null; cookingStartedAtMs: number | string | null; cookingCompletedAtMs: number | string | null };

const timestampMs = (value: number | string | null | undefined) => {
  const parsed = value === null || value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function POST(request: Request) {
  if (!isSameOriginQrRequest(request)) return Response.json({ success: false }, { status: 403 });
  const member = await resolveQrOrderRequest(request);
  if (!member) return Response.json({ success: false, message: "테이블 QR 인증이 만료되었습니다. QR을 다시 스캔해 주세요." }, { status: 401 });
  const body = await request.json().catch(() => null) as { requestId?: unknown; cart?: unknown; authAttemptId?: unknown } | null;
  const requestId = body?.requestId;
  if (!body || typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId) || !Array.isArray(body.cart)) return Response.json({ success: false, message: "주문 요청 정보가 유효하지 않습니다." }, { status: 400 });
  try {
    const representativeMode = await isQrOrderAuthRuntimeEnabled();
    if (process.env.TDK_QR_ORDER_AUTH_ENABLED === "true" && !representativeMode)
      return Response.json({ success: false, message: "QR 주문 인증 설정 또는 DB 구조를 확인해 주세요." }, { status: 503 });
    const catalog = enrichQrCatalog(await loadQrMenuCatalog());
    const lines = validateQrWaitCart(body.cart, catalog);
    if (!lines?.length) return Response.json({ success: false, message: "메뉴 또는 옵션이 변경되었습니다. 장바구니를 확인해 주세요." }, { status: 409 });
    const total = qrWaitCartTotal(lines);
    if (!Number.isSafeInteger(Math.round(total * 100)) || total < 0) return Response.json({ success: false }, { status: 400 });
    const cartFingerprint = representativeMode ? qrOrderAuthCartFingerprint(lines.map(({ line }) => ({ menuId: line.menuId, qty: line.qty,
      options: line.options.map(option => ({ modifierOptionId: option.modifierOptionId, qty: option.qty })) }))) : null;
    const result = await db.transaction(async tx => {
      const [snapshot] = await tx.select({ sessionId: qrSessions.sessionId, tableId: qrSessions.tableId, status: qrSessions.status })
        .from(qrSessions).where(eq(qrSessions.qrSessionId, member.qrSessionId)).limit(1);
      if (!snapshot || snapshot.status !== "ACTIVE") return { kind: "CLOSED" as const };
      const actualSession = snapshot.sessionId ? (await tx.select({ sessionId: tableSessions.sessionId, tableId: tableSessions.tableId })
        .from(tableSessions).where(eq(tableSessions.sessionId, snapshot.sessionId)).limit(1))[0] : null;
      const tableId = Number(actualSession?.tableId ?? snapshot.tableId ?? member.tableId);
      const [existing] = await tx.select({ qrOrderId: qrOrders.qrOrderId, qrSessionId: qrOrders.qrSessionId })
        .from(qrOrders).where(eq(qrOrders.clientRequestId, requestId)).limit(1);
      if (existing) return existing.qrSessionId === member.qrSessionId
        ? { kind: "EXISTING" as const, qrOrderId: Number(existing.qrOrderId) }
        : { kind: "DUPLICATE" as const };
      const [table] = await tx.select({ tableId: diningTables.tableId }).from(diningTables)
        .where(and(eq(diningTables.tableId, tableId), eq(diningTables.isActive, 1))).for("update").limit(1);
      if (!table) return { kind: "CLOSED" as const };
      const openSessions = await tx.select({ sessionId: tableSessions.sessionId }).from(tableSessions)
        .where(and(eq(tableSessions.tableId, tableId), eq(tableSessions.status, "OPEN"), eq(tableSessions.sessionKind, "DINE_IN"))).for("update");
      const [customer] = await tx.select({ qrSessionId: qrSessions.qrSessionId, sessionId: qrSessions.sessionId, tableId: qrSessions.tableId, status: qrSessions.status })
        .from(qrSessions).where(eq(qrSessions.qrSessionId, member.qrSessionId)).for("update").limit(1);
      if (!customer || customer.status !== "ACTIVE") return { kind: "CLOSED" as const };
      if (Number(customer.tableId) !== tableId) return { kind: "CLOSED" as const };
      if (customer.sessionId !== null && !openSessions.some(row => Number(row.sessionId) === Number(customer.sessionId))) return { kind: "CLOSED" as const };
      const [activeQr] = await tx.select({ qrCodeId: qrCodes.qrCodeId }).from(qrTableLinks)
        .innerJoin(qrCodes, eq(qrCodes.qrCodeId, qrTableLinks.qrCodeId))
        .where(and(eq(qrTableLinks.tableId, tableId), eq(qrCodes.status, "IN_USE"), eq(qrCodes.targetType, "TABLE_ORDER"))).limit(1);
      if (!activeQr) return { kind: "QR_INVALID" as const };
      let firstOrder = false;
      if (representativeMode) {
        if (openSessions.length > 1) return { kind: "SESSION_CONFLICT" as const };
        const claim = await getQrTableOrderClaim(tx, tableId);
        if (claim) {
          if (Number(claim.representativeQrSessionId) !== member.qrSessionId) return { kind: "OTHER_REPRESENTATIVE" as const };
          if (claim.state !== "CONFIRMED") return { kind: "APPROVAL_PENDING" as const };
          if (!claim.tableSessionId || !openSessions.some(row => Number(row.sessionId) === Number(claim.tableSessionId)) ||
            Number(customer.sessionId) !== Number(claim.tableSessionId)) return { kind: "CLOSED" as const };
        } else {
          firstOrder = true;
          if (typeof body.authAttemptId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.authAttemptId)) return { kind: "AUTH_REQUIRED" as const };
          const [attempt] = await tx.select({ attemptId: qrOrderAuthAttempts.attemptId, state: qrOrderAuthAttempts.state,
            tableId: qrOrderAuthAttempts.tableId, requestId: qrOrderAuthAttempts.clientRequestId,
            cartFingerprint: qrOrderAuthAttempts.cartFingerprint,
            tableSessionIdAtAuth: qrOrderAuthAttempts.tableSessionIdAtAuth,
            sessionSnapshotRecorded: qrOrderAuthAttempts.sessionSnapshotRecorded,
            expired: sql<number>`${qrOrderAuthAttempts.expiresAt} <= CURRENT_TIMESTAMP(3)`,
          })
            .from(qrOrderAuthAttempts).where(and(eq(qrOrderAuthAttempts.attemptId, body.authAttemptId),
              eq(qrOrderAuthAttempts.qrSessionId, member.qrSessionId))).for("update").limit(1);
          if (!attempt || attempt.state !== "VERIFIED" || Number(attempt.tableId) !== tableId ||
            attempt.requestId !== requestId || attempt.cartFingerprint !== cartFingerprint || Number(attempt.expired) === 1 ||
            Number(attempt.sessionSnapshotRecorded) !== 1 ||
            (attempt.tableSessionIdAtAuth === null ? openSessions.length !== 0
              : !openSessions.some(row => Number(row.sessionId) === Number(attempt.tableSessionIdAtAuth))))
            return { kind: "AUTH_REQUIRED" as const };
        }
      }
      const [created] = await tx.insert(qrOrders).values({ qrSessionId: customer.qrSessionId, clientRequestId: requestId,
        status: "PENDING", subtotalAmount: total.toFixed(2), discountAmount: "0.00", totalAmount: total.toFixed(2) });
      const qrOrderId = Number(created.insertId);
      for (const entry of lines) {
        const [item] = await tx.insert(qrOrderItems).values({ qrOrderId, menuId: entry.line.menuId, itemName: entry.itemName,
          qty: entry.line.qty, unitPrice: entry.unitPrice.toFixed(2), totalAmount: entry.lineTotal.toFixed(2) });
        const menu = catalog.menus.find(candidate => candidate.menuId === entry.line.menuId)!;
        if (entry.optionSnapshots.length) await tx.insert(qrOrderItemOptions).values(entry.optionSnapshots.map(option => {
          const group = menu.groups.find(candidate => candidate.options.some(candidateOption => candidateOption.modifierOptionId === option.modifierOptionId));
          const independent = group?.source === "MENU_ADDON";
          const multiplier = independent ? option.qty : option.qty * entry.line.qty;
          return { qrOrderItemId: Number(item.insertId), modifierOptionId: option.modifierOptionId,
            optionName: option.optionName, qty: option.qty, unitPrice: option.unitPrice,
            totalAmount: (Number(option.unitPrice) * multiplier).toFixed(2) };
        }));
      }
      if (representativeMode && firstOrder) {
        const claimResult = await createQrTableOrderClaim(tx, { tableId, representativeQrSessionId: member.qrSessionId,
          firstQrOrderId: qrOrderId }, openSessions[0] ? Number(openSessions[0].sessionId) : null);
        if (claimResult !== "CREATED") throw new Error(`QR_CLAIM_${claimResult}`);
        const [consumed] = await tx.update(qrOrderAuthAttempts).set({ state: "CONSUMED", consumedAt: new Date(), qrOrderId })
          .where(and(eq(qrOrderAuthAttempts.attemptId, body.authAttemptId as string),
            eq(qrOrderAuthAttempts.qrSessionId, member.qrSessionId), eq(qrOrderAuthAttempts.state, "VERIFIED")));
        if (consumed.affectedRows !== 1) throw new Error("QR_AUTH_ALREADY_CONSUMED");
      }
      return { kind: "CREATED" as const, qrOrderId };
    });
    if (result.kind === "CLOSED") return Response.json({ success: false, message: "테이블 이용이 종료되었거나 고객 세션이 만료되었습니다. QR을 다시 스캔해 주세요." }, { status: 409 });
    if (result.kind === "QR_INVALID") return Response.json({ success: false, message: "이 QR은 폐기되었거나 테이블 연결이 변경되었습니다. QR을 다시 확인해 주세요." }, { status: 409 });
    if (result.kind === "DUPLICATE") return Response.json({ success: false, message: "중복 주문 요청이 확인되었습니다." }, { status: 409 });
    if (result.kind === "AUTH_REQUIRED") return Response.json({ success: false, code: "AUTH_REQUIRED", message: "인증번호 확인 후 주문을 접수해 주세요." }, { status: 403 });
    if (result.kind === "OTHER_REPRESENTATIVE") return Response.json({ success: false, code: "OTHER_REPRESENTATIVE", message: "현재 이 테이블의 주문은 대표 고객이 진행하고 있습니다." }, { status: 403 });
    if (result.kind === "APPROVAL_PENDING") return Response.json({ success: false, code: "APPROVAL_PENDING", message: "주문 승인 대기 중입니다." }, { status: 409 });
    if (result.kind === "SESSION_CONFLICT") return Response.json({ success: false, message: "테이블 이용 세션을 확인할 수 없습니다." }, { status: 409 });
    return Response.json({ success: true, qrOrderId: result.qrOrderId, status: "PENDING", duplicate: result.kind === "EXISTING" }, { status: result.kind === "CREATED" ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "QR_CLAIM_CONFLICT")
      return Response.json({ success: false, code: "OTHER_REPRESENTATIVE", message: "현재 이 테이블의 주문은 대표 고객이 진행하고 있습니다." }, { status: 403 });
    if (error instanceof Error && ["QR_CLAIM_EXISTING", "QR_CLAIM_INVALID", "QR_AUTH_ALREADY_CONSUMED"].includes(error.message))
      return Response.json({ success: false, code: "AUTH_REQUIRED", message: "인증 상태가 변경되었습니다. 다시 확인해 주세요." }, { status: 409 });
    return Response.json({ success: false, message: "주문을 전송하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
}

export async function GET(request: Request) {
  const member = await resolveQrOrderRequest(request);
  if (!member) {
    try {
      const accessState = await classifyQrOrderRequestFailure(request);
      if (accessState === "PAYMENT_COMPLETED") return Response.json({
        success: true, accessState, canViewOrders: false, orders: [], items: [],
      }, { headers: { "Cache-Control": "no-store" } });
      return Response.json({ success: false, code: accessState }, { status: 401, headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ success: false, code: "ACCESS_CHECK_FAILED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  }
  try {
    // Order-history read access is scoped to the QR's current table visit.
    // It does not grant invite or order-submission privileges. Bound tokens
    // remain pinned to their own visit; unbound scans use the table's sole
    // open visit, if one exists.
    const activeVisits = member.sessionId === null
      ? await db.select({ sessionId: tableSessions.sessionId, personCount: tableSessions.personCount,
        babyCount: tableSessions.babyCount }).from(tableSessions).where(and(
          eq(tableSessions.tableId, member.tableId), eq(tableSessions.sessionKind, "DINE_IN"), eq(tableSessions.status, "OPEN"),
        )).orderBy(desc(tableSessions.sessionId)).limit(2)
      : await db.select({ sessionId: tableSessions.sessionId, personCount: tableSessions.personCount,
        babyCount: tableSessions.babyCount }).from(tableSessions).where(and(
          eq(tableSessions.sessionId, member.sessionId), eq(tableSessions.tableId, member.tableId),
          eq(tableSessions.sessionKind, "DINE_IN"), eq(tableSessions.status, "OPEN"),
        )).limit(1);
    if (activeVisits.length > 1) return Response.json({ success: false, code: "SESSION_CONFLICT" },
      { status: 409, headers: { "Cache-Control": "no-store" } });
    const activeSession = activeVisits[0];
    const currentVisitSessionId = activeSession ? Number(activeSession.sessionId) : null;
    const registeredPeople = activeSession ? Number(activeSession.personCount) + Number(activeSession.babyCount) : 0;
    const totalPersonCount = registeredPeople > 0 ? registeredPeople : null;
    const orderSelection = { qrOrderId: qrOrders.qrOrderId, status: qrOrders.status, totalAmount: qrOrders.totalAmount,
      orderedAt: sql<string>`CONCAT(DATE_FORMAT(${qrOrders.orderedAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00')`,
      acceptedOrderId: qrOrders.acceptedOrderId, acceptedAt: qrOrders.acceptedAt, note: qrOrders.note };
    const ownRequests = await db.select(orderSelection).from(qrOrders)
      .where(eq(qrOrders.qrSessionId, member.qrSessionId)).orderBy(asc(qrOrders.orderedAt), asc(qrOrders.qrOrderId));
    const orders = currentVisitSessionId === null ? [] : await db.select(orderSelection).from(qrOrders)
      .innerJoin(qrSessions, eq(qrSessions.qrSessionId, qrOrders.qrSessionId))
      .innerJoin(posOrderTable, eq(posOrderTable.orderId, qrOrders.acceptedOrderId))
      .where(and(eq(qrSessions.sessionId, currentVisitSessionId), eq(posOrderTable.sessionId, currentVisitSessionId),
        eq(qrOrders.status, "ACCEPTED"), eq(posOrderTable.orderType, "POS")))
      .orderBy(asc(qrOrders.orderedAt), asc(qrOrders.qrOrderId));
    const posOrderRows = currentVisitSessionId === null ? [] : await db.select({ orderId: posOrderTable.orderId, sessionId: posOrderTable.sessionId,
      orderType: posOrderTable.orderType, status: posOrderTable.status, totalAmount: posOrderTable.totalAmount,
      orderedAt: sql<string>`CONCAT(DATE_FORMAT(${posOrderTable.orderedAt}, '%Y-%m-%dT%H:%i:%s'), '+09:00')` })
      .from(posOrderTable).where(and(eq(posOrderTable.sessionId, currentVisitSessionId), eq(posOrderTable.orderType, "POS")))
      .orderBy(desc(posOrderTable.orderedAt), desc(posOrderTable.orderId));
    const acceptedQrIdByPosOrderId = new Map(orders.flatMap(order => order.acceptedOrderId === null ? [] : [[Number(order.acceptedOrderId), Number(order.qrOrderId)] as const]));
    const posOrders = posOrderRows.map(order => ({ ...order, orderId: Number(order.orderId), sessionId: Number(order.sessionId),
      acceptedQrOrderId: acceptedQrIdByPosOrderId.get(Number(order.orderId)) ?? null }));
    const posOrderIds = posOrders.map(order => order.orderId);
    const posItemRows = posOrderIds.length ? await db.select({ orderId: orderItems.orderId, orderItemId: orderItems.orderItemId,
      parentOrderItemId: orderItems.parentOrderItemId, menuId: orderItems.menuId, actualComponentQty: orderItems.actualComponentQty,
      itemType: orderItems.itemType, status: orderItems.status, itemName: orderItems.itemName, qty: orderItems.qty,
      unitPrice: orderItems.unitPrice, totalAmount: orderItems.totalAmount })
      .from(orderItems).where(inArray(orderItems.orderId, posOrderIds)).orderBy(asc(orderItems.orderedAt), asc(orderItems.orderItemId)) : [];
    const posItemIds = posItemRows.map(item => Number(item.orderItemId));
    const posCancellationRows = posItemIds.length ? await db.select({ orderItemId: orderItemCancellations.orderItemId,
      cancelledQty: orderItemCancellations.cancelledQty, cancelledAmount: orderItemCancellations.cancelledAmount })
      .from(orderItemCancellations).where(inArray(orderItemCancellations.orderItemId, posItemIds)) : [];
    const posOptions = posItemIds.length ? await db.select({ orderItemId: orderItemOptions.orderItemId,
      modifierOptionId: orderItemOptions.modifierOptionId, optionName: orderItemOptions.optionName, qty: orderItemOptions.qty,
      unitPrice: orderItemOptions.unitPrice, totalAmount: orderItemOptions.totalAmount, groupName: modifierGroups.posName })
      .from(orderItemOptions).leftJoin(modifierOptions, eq(orderItemOptions.modifierOptionId, modifierOptions.modifierOptionId))
      .leftJoin(modifierGroups, eq(modifierOptions.modifierGroupId, modifierGroups.modifierGroupId))
      .where(inArray(orderItemOptions.orderItemId, posItemIds)).orderBy(asc(orderItemOptions.orderItemOptionId)) : [];
    const cancelledQtyByItem = new Map<number, number>();
    posCancellationRows.forEach(row => cancelledQtyByItem.set(Number(row.orderItemId),
      (cancelledQtyByItem.get(Number(row.orderItemId)) ?? 0) + Number(row.cancelledQty)));
    const posOrderStatusById = new Map(posOrders.map(order => [order.orderId, order.status]));
    const posItemDetails = posItemRows.map(item => {
      const orderId = Number(item.orderId);
      const orderStatus = posOrderStatusById.get(orderId);
      const orderItemId = Number(item.orderItemId);
      const originalQty = Number(item.actualComponentQty ?? item.qty);
      const cancelledQty = cancelledQtyByItem.get(orderItemId) ?? 0;
      const effectiveQty = orderStatus === "CANCELLED" || item.status === "CANCELLED" ? 0 : Math.max(0, originalQty - cancelledQty);
      const options = posOptions.filter(option => Number(option.orderItemId) === orderItemId).map(option => ({
        modifierOptionId: option.modifierOptionId === null ? null : Number(option.modifierOptionId),
        optionName: option.optionName, qty: Number(option.qty), unitPrice: option.unitPrice,
        independentQty: isQrMenuAddonGroupName(option.groupName ?? ""),
      }));
      const originalAmountCents = Math.round(Number(item.totalAmount) * 100);
      const independentAddonCents = options.filter(option => option.independentQty)
        .reduce((sum, option) => sum + Math.round(Number(option.unitPrice) * 100) * option.qty, 0);
      const effectiveAmountCents = item.itemType === "SERVICE" || effectiveQty <= 0 ? 0
        : Math.round((originalAmountCents - independentAddonCents) * effectiveQty / Math.max(1, Number(item.qty))) + independentAddonCents;
      return { ...item, orderId, orderItemId, menuId: Number(item.menuId), parentOrderItemId: item.parentOrderItemId === null ? null : Number(item.parentOrderItemId),
        qty: Number(item.qty), actualComponentQty: item.actualComponentQty === null ? null : Number(item.actualComponentQty), originalQty,
        effectiveQty, cancelledQty, effectiveTotalAmount: (effectiveAmountCents / 100).toFixed(2), options };
    });
    const sessionDiscountRows = currentVisitSessionId === null ? [] : await db.select({ amount: tableSessionDiscounts.discountAmount })
      .from(tableSessionDiscounts).where(eq(tableSessionDiscounts.sessionId, currentVisitSessionId));
    const sessionPaymentRows = currentVisitSessionId === null ? [] : await db.select({ amount: paymentSessionAllocations.appliedAmount })
      .from(paymentSessionAllocations).innerJoin(payments, eq(paymentSessionAllocations.paymentId, payments.paymentId))
      .where(and(eq(paymentSessionAllocations.sessionId, currentVisitSessionId), eq(payments.status, "APPROVED")));
    const summaryItems = posItemDetails.map(item => ({ ...item, status: item.status,
      options: item.options.map(option => ({ ...option, totalAmount: (Number(option.unitPrice) * option.qty).toFixed(2) })) }));
    const summaryCancellations = posCancellationRows.map(row => ({ orderItemId: Number(row.orderItemId), cancelledQty: Number(row.cancelledQty) }));
    const confirmedSummary = buildQrConfirmedOrderSummary({
      orders: posOrders,
      items: summaryItems,
      cancellations: summaryCancellations,
      discountAmount: sessionDiscountRows.reduce((sum, row) => sum + Number(row.amount), 0),
      prepaidAmount: sessionPaymentRows.reduce((sum, row) => sum + Number(row.amount), 0),
    }, buildOrderSummaryRows);
    const roundGrossByOrderId = new Map(posOrders.map(order => [order.orderId, buildQrConfirmedOrderSummary({
      orders: [order], items: summaryItems.filter(item => item.orderId === order.orderId),
      cancellations: summaryCancellations.filter(cancellation => posItemDetails.some(item => item.orderId === order.orderId && item.orderItemId === cancellation.orderItemId)),
      discountAmount: 0, prepaidAmount: 0,
    }, buildOrderSummaryRows).grossAmount]));
    const ids = orders.map(order => Number(order.qrOrderId));
    const ownIds = ownRequests.map(order => Number(order.qrOrderId));
    const allIds = [...new Set([...ids, ...ownIds])];
    const allQrItems = allIds.length ? await db.select({ qrOrderId: qrOrderItems.qrOrderId, qrOrderItemId: qrOrderItems.qrOrderItemId,
      menuId: qrOrderItems.menuId, itemName: qrOrderItems.itemName, qty: qrOrderItems.qty, unitPrice: qrOrderItems.unitPrice,
      totalAmount: qrOrderItems.totalAmount }).from(qrOrderItems).where(inArray(qrOrderItems.qrOrderId, allIds)).orderBy(asc(qrOrderItems.qrOrderItemId)) : [];
    const sharedIds = new Set(ids);
    const items = allQrItems.filter(item => sharedIds.has(Number(item.qrOrderId)));
    const itemIds = allQrItems.map(item => Number(item.qrOrderItemId));
    const options = itemIds.length ? await db.select({ qrOrderItemId: qrOrderItemOptions.qrOrderItemId,
      optionName: qrOrderItemOptions.optionName, qty: qrOrderItemOptions.qty, totalAmount: qrOrderItemOptions.totalAmount })
      .from(qrOrderItemOptions).where(inArray(qrOrderItemOptions.qrOrderItemId, itemIds)) : [];
    const taskByItem = new Map<number, { status: string; timerMinutes: number | null; timerStartedAtMs: number | string | null; cookingStartedAtMs: number | string | null; cookingCompletedAtMs: number | string | null; kind: string }>();
    const acceptedIds = orders.flatMap(order => order.acceptedOrderId ? [Number(order.acceptedOrderId)] : []);
    const standardItemByQrItem = new Map<number, number>();
    if (acceptedIds.length) {
      const [standardItems] = await pool.query<StandardItemRow[]>(
        `SELECT order_id AS orderId, order_item_id AS orderItemId, menu_id AS menuId FROM order_items
         WHERE order_id IN (${acceptedIds.map(() => "?").join(",")}) AND parent_order_item_id IS NULL AND item_type='NORMAL' ORDER BY order_item_id`, acceptedIds);
      const used = new Set<number>();
      for (const order of orders) {
        if (!order.acceptedOrderId) continue;
        const candidates = standardItems.filter(item => item.orderId === Number(order.acceptedOrderId));
        for (const qrItem of items.filter(item => Number(item.qrOrderId) === Number(order.qrOrderId))) {
          const candidate = candidates.find(item => !used.has(item.orderItemId) && item.menuId === Number(qrItem.menuId));
          if (candidate) { standardItemByQrItem.set(Number(qrItem.qrOrderItemId), candidate.orderItemId); used.add(candidate.orderItemId); }
        }
      }
    }
    if (posOrderIds.length) {
      const [tasks] = await pool.query<KdsTaskRow[]>(
        `SELECT order_id AS orderId, member_items AS memberItems, kind, status,
          post_cook_timer_minutes AS postCookTimerMinutes, post_cook_timer_started_at_ms AS postCookTimerStartedAtMs,
          cooking_started_at_ms AS cookingStartedAtMs, cooking_completed_at_ms AS cookingCompletedAtMs
         FROM kds_tasks WHERE order_id IN (${posOrderIds.map(() => "?").join(",")})`, posOrderIds);
      for (const task of tasks) {
        try {
          for (const memberItem of JSON.parse(task.memberItems) as Array<{ itemId?: number; kind?: string }>) {
            if (memberItem.kind !== "COMPONENT" && Number.isInteger(memberItem.itemId)) taskByItem.set(memberItem.itemId!, {
              status: task.status, timerMinutes: task.postCookTimerMinutes, timerStartedAtMs: task.postCookTimerStartedAtMs,
              cookingStartedAtMs: task.cookingStartedAtMs, cookingCompletedAtMs: task.cookingCompletedAtMs, kind: task.kind });
          }
        } catch { /* malformed historical KDS snapshot: omit progress for this task */ }
      }
    }
    const menuIds = [...new Set([...items.map(item => Number(item.menuId)), ...posItemDetails.map(item => item.menuId)])];
    const menuKinds = menuIds.length ? await db.select({ menuId: menus.menuId, kdsKind: menus.kdsKind, kdsVisible: menus.kdsVisible,
      postCookTimer: menus.kdsPostCookTimer, categoryName: menuCategories.posName })
      .from(menus).leftJoin(menuCategories, eq(menus.categoryId, menuCategories.categoryId)).where(inArray(menus.menuId, menuIds)) : [];
    const kindByMenu = new Map(menuKinds.map(menu => [Number(menu.menuId), {
      kdsKind: menu.kdsKind, kdsVisible: menu.kdsVisible === 1, postCookTimer: menu.postCookTimer === 1, categoryName: menu.categoryName,
    }]));
    const stageItems = items.map(item => {
      const kds = taskByItem.get(standardItemByQrItem.get(Number(item.qrOrderItemId)) ?? -1);
      const menu = kindByMenu.get(Number(item.menuId));
      const stage = !menu || !menu.kdsVisible || menu.kdsKind === "NONE" ? null : !kds ? "WAITING" : kds.status;
      const timerStartedAtMs = kds?.status === "DONE" ? timestampMs(kds.timerStartedAtMs) : null;
      const timerMinutes = kds?.status === "DONE" && Number.isInteger(Number(kds.timerMinutes)) && Number(kds.timerMinutes) > 0
        ? Number(kds.timerMinutes) : null;
      return { ...item, qrOrderItemId: Number(item.qrOrderItemId), qty: Number(item.qty), options: options.filter(option => Number(option.qrOrderItemId) === Number(item.qrOrderItemId)),
        kdsKind: menu?.kdsKind ?? "NONE", stage, kdsStartedAtMs: timestampMs(kds?.cookingStartedAtMs),
        kdsCompletedAtMs: timestampMs(kds?.cookingCompletedAtMs), postCookTimerEligible: Boolean(menu?.kdsVisible && menu.kdsKind === "POT" && menu.postCookTimer),
        postCookTimerMinutes: timerMinutes, postCookTimerStartedAtMs: timerStartedAtMs,
        showCookingProgress: menu ? isQrCookingProgressMenu({ categoryName: menu.categoryName, kdsKind: menu.kdsKind,
          kdsVisible: menu.kdsVisible }) : false };
    });
    const stagePosItems = posItemDetails.map(item => {
      const kds = taskByItem.get(item.orderItemId);
      const menu = kindByMenu.get(item.menuId);
      const stage = !menu || !menu.kdsVisible || menu.kdsKind === "NONE" ? null : !kds ? "WAITING" : kds.status;
      return { ...item, kdsKind: menu?.kdsKind ?? "NONE", stage,
        postCookTimerEligible: Boolean(menu?.kdsVisible && menu.kdsKind === "POT" && menu.postCookTimer),
        postCookTimerMinutes: kds?.status === "DONE" && Number.isInteger(Number(kds.timerMinutes)) && Number(kds.timerMinutes) > 0 ? Number(kds.timerMinutes) : null,
        postCookTimerStartedAtMs: kds?.status === "DONE" ? timestampMs(kds.timerStartedAtMs) : null,
        showCookingProgress: menu ? isQrCookingProgressMenu({ categoryName: menu.categoryName, kdsKind: menu.kdsKind,
          kdsVisible: menu.kdsVisible }) : false };
    });
    if (currentVisitSessionId !== null) {
      const [stillOpen] = await db.select({ sessionId: tableSessions.sessionId }).from(tableSessions).where(and(
        eq(tableSessions.sessionId, currentVisitSessionId), eq(tableSessions.tableId, member.tableId),
        eq(tableSessions.sessionKind, "DINE_IN"), eq(tableSessions.status, "OPEN"),
      )).limit(1);
      if (!stillOpen) return Response.json({ success: false, code: "VISIT_ENDED" },
        { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ success: true, tableNo: member.tableNo, capacity: member.capacity, qrSessionId: member.qrSessionId, isTest: member.isTest,
      canViewOrders: member.canViewOrders, canViewCurrentVisitOrders: currentVisitSessionId !== null, needsJoin: false, totalPersonCount,
      serverNow: Date.now(), orders, items: stageItems, ownRequests,
      ownRequestItems: allQrItems.filter(item => ownIds.includes(Number(item.qrOrderId))).map(item => ({
        ...item, qrOrderItemId: Number(item.qrOrderItemId), qty: Number(item.qty),
        options: options.filter(option => Number(option.qrOrderItemId) === Number(item.qrOrderItemId)),
      })),
      posOrders: posOrders.map(order => ({ orderId: order.orderId, acceptedQrOrderId: order.acceptedQrOrderId, status: order.status,
        totalAmount: order.totalAmount, effectiveTotalAmount: (roundGrossByOrderId.get(order.orderId) ?? 0).toFixed(2), orderedAt: order.orderedAt })),
      posItems: stagePosItems.map(item => ({ orderId: item.orderId, orderItemId: item.orderItemId, parentOrderItemId: item.parentOrderItemId,
        menuId: item.menuId, itemType: item.itemType, status: item.status, itemName: item.itemName, qty: item.qty, originalQty: item.originalQty,
        effectiveQty: item.effectiveQty, cancelledQty: item.cancelledQty, unitPrice: item.unitPrice, totalAmount: item.totalAmount,
        effectiveTotalAmount: item.effectiveTotalAmount, kdsKind: item.kdsKind, stage: item.stage, postCookTimerEligible: item.postCookTimerEligible,
        postCookTimerMinutes: item.postCookTimerMinutes, postCookTimerStartedAtMs: item.postCookTimerStartedAtMs, showCookingProgress: item.showCookingProgress,
        options: item.options.map(option => ({ modifierOptionId: option.modifierOptionId, optionName: option.optionName, qty: option.qty,
          unitPrice: option.unitPrice, independentQty: option.independentQty })) })),
      confirmedSummary: currentVisitSessionId === null ? undefined : { items: confirmedSummary.rows.map(row => ({ menuId: row.rowKey, itemName: row.name, qty: row.qty,
        totalAmount: row.total, optionLabel: row.optionLabel ?? "", itemType: row.itemType ?? "NORMAL",
        components: row.components.map(component => ({ itemName: component.name, qty: component.qty, totalAmount: component.total })) })),
        grossAmount: confirmedSummary.grossAmount, discountAmount: confirmedSummary.discountAmount, prepaidAmount: confirmedSummary.prepaidAmount,
        totalAmount: confirmedSummary.totalAmount, receivableAmount: confirmedSummary.receivableAmount } },
    { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "주문내역을 불러오지 못했습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
