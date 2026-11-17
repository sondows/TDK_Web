import { and, asc, eq, inArray } from "drizzle-orm";
import type { RowDataPacket } from "mysql2/promise";
import { db, pool } from "@/db";
import { diningTables, menus, qrCodes, qrOrderItemOptions, qrOrderItems, qrOrders, qrSessions, qrTableLinks, tableSessions } from "@/db/schema";
import { isSameOriginQrRequest } from "@/lib/qr-visit-session";
import { resolveQrOrderRequest } from "@/lib/qr-order-auth";
import { enrichQrCatalog, qrWaitCartTotal, validateQrWaitCart } from "@/lib/qr-wait-order-data";
import { loadQrMenuCatalog } from "@/lib/qr-menu-catalog";

export const dynamic = "force-dynamic";

type StandardItemRow = RowDataPacket & { orderId: number; orderItemId: number; menuId: number };
type KdsTaskRow = RowDataPacket & { orderId: number; memberItems: string; kind: string; status: string; postCookTimerMinutes: number | null; postCookTimerStartedAtMs: number | null };

export async function POST(request: Request) {
  if (!isSameOriginQrRequest(request)) return Response.json({ success: false }, { status: 403 });
  const member = await resolveQrOrderRequest(request);
  if (!member) return Response.json({ success: false, message: "테이블 QR 인증이 만료되었습니다. QR을 다시 스캔해 주세요." }, { status: 401 });
  const body = await request.json().catch(() => null) as { requestId?: unknown; cart?: unknown } | null;
  const requestId = body?.requestId;
  if (!body || typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId) || !Array.isArray(body.cart)) return Response.json({ success: false, message: "주문 요청 정보가 유효하지 않습니다." }, { status: 400 });
  try {
    const catalog = enrichQrCatalog(await loadQrMenuCatalog());
    const lines = validateQrWaitCart(body.cart, catalog);
    if (!lines?.length) return Response.json({ success: false, message: "메뉴 또는 옵션이 변경되었습니다. 장바구니를 확인해 주세요." }, { status: 409 });
    const total = qrWaitCartTotal(lines);
    if (!Number.isSafeInteger(Math.round(total * 100)) || total < 0) return Response.json({ success: false }, { status: 400 });
    const result = await db.transaction(async tx => {
      const [snapshot] = await tx.select({ sessionId: qrSessions.sessionId, tableId: qrSessions.tableId, status: qrSessions.status })
        .from(qrSessions).where(eq(qrSessions.qrSessionId, member.qrSessionId)).limit(1);
      if (!snapshot || snapshot.status !== "ACTIVE") return { kind: "CLOSED" as const };
      const actualSession = snapshot.sessionId ? (await tx.select({ sessionId: tableSessions.sessionId, tableId: tableSessions.tableId })
        .from(tableSessions).where(eq(tableSessions.sessionId, snapshot.sessionId)).limit(1))[0] : null;
      const tableId = Number(actualSession?.tableId ?? snapshot.tableId ?? member.tableId);
      const [table] = await tx.select({ tableId: diningTables.tableId }).from(diningTables)
        .where(and(eq(diningTables.tableId, tableId), eq(diningTables.isActive, 1))).for("update").limit(1);
      if (!table) return { kind: "CLOSED" as const };
      const openSessions = await tx.select({ sessionId: tableSessions.sessionId }).from(tableSessions)
        .where(and(eq(tableSessions.tableId, tableId), eq(tableSessions.status, "OPEN"), eq(tableSessions.sessionKind, "DINE_IN"))).for("update");
      const [customer] = await tx.select({ qrSessionId: qrSessions.qrSessionId, sessionId: qrSessions.sessionId, tableId: qrSessions.tableId, status: qrSessions.status })
        .from(qrSessions).where(eq(qrSessions.qrSessionId, member.qrSessionId)).for("update").limit(1);
      if (!customer || customer.status !== "ACTIVE") return { kind: "CLOSED" as const };
      if (customer.sessionId !== null && !openSessions.some(row => Number(row.sessionId) === Number(customer.sessionId))) return { kind: "CLOSED" as const };
      const [activeQr] = await tx.select({ qrCodeId: qrCodes.qrCodeId }).from(qrTableLinks)
        .innerJoin(qrCodes, eq(qrCodes.qrCodeId, qrTableLinks.qrCodeId))
        .where(and(eq(qrTableLinks.tableId, tableId), eq(qrCodes.status, "IN_USE"), eq(qrCodes.targetType, "TABLE_ORDER"))).limit(1);
      if (!activeQr) return { kind: "QR_INVALID" as const };
      const [existing] = await tx.select({ qrOrderId: qrOrders.qrOrderId, qrSessionId: qrOrders.qrSessionId })
        .from(qrOrders).where(eq(qrOrders.clientRequestId, requestId)).limit(1);
      if (existing) return existing.qrSessionId === member.qrSessionId
        ? { kind: "EXISTING" as const, qrOrderId: Number(existing.qrOrderId) }
        : { kind: "DUPLICATE" as const };
      if (customer.sessionId === null && openSessions.length) return { kind: "JOIN_REQUIRED" as const };
      const [created] = await tx.insert(qrOrders).values({ qrSessionId: customer.qrSessionId, clientRequestId: requestId,
        status: "PENDING", subtotalAmount: total.toFixed(2), discountAmount: "0.00", totalAmount: total.toFixed(2), orderedAt: new Date() });
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
      return { kind: "CREATED" as const, qrOrderId };
    });
    if (result.kind === "CLOSED") return Response.json({ success: false, message: "테이블 이용이 종료되었거나 고객 세션이 만료되었습니다. QR을 다시 스캔해 주세요." }, { status: 409 });
    if (result.kind === "QR_INVALID") return Response.json({ success: false, message: "이 QR은 폐기되었거나 테이블 연결이 변경되었습니다. QR을 다시 확인해 주세요." }, { status: 409 });
    if (result.kind === "JOIN_REQUIRED") return Response.json({ success: false, message: "이미 이용 중인 테이블입니다. 기존 고객에게 일행 초대를 요청해 주세요." }, { status: 409 });
    if (result.kind === "DUPLICATE") return Response.json({ success: false, message: "중복 주문 요청이 확인되었습니다." }, { status: 409 });
    return Response.json({ success: true, qrOrderId: result.qrOrderId, status: "PENDING", duplicate: result.kind === "EXISTING" }, { status: result.kind === "CREATED" ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "주문을 전송하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
}

export async function GET(request: Request) {
  const member = await resolveQrOrderRequest(request);
  if (!member) return Response.json({ success: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const [occupiedTable] = member.sessionId === null ? await db.select({ sessionId: tableSessions.sessionId }).from(tableSessions)
      .where(and(eq(tableSessions.tableId, member.tableId), eq(tableSessions.sessionKind, "DINE_IN"), eq(tableSessions.status, "OPEN"))).limit(1) : [];
    const orderSelection = { qrOrderId: qrOrders.qrOrderId, status: qrOrders.status, totalAmount: qrOrders.totalAmount,
      orderedAt: qrOrders.orderedAt, acceptedOrderId: qrOrders.acceptedOrderId, acceptedAt: qrOrders.acceptedAt, note: qrOrders.note };
    const orders = member.sessionId === null
      ? await db.select(orderSelection).from(qrOrders).where(eq(qrOrders.qrSessionId, member.qrSessionId)).orderBy(asc(qrOrders.orderedAt), asc(qrOrders.qrOrderId))
      : await db.select(orderSelection).from(qrOrders).innerJoin(qrSessions, eq(qrSessions.qrSessionId, qrOrders.qrSessionId))
        .where(eq(qrSessions.sessionId, member.sessionId)).orderBy(asc(qrOrders.orderedAt), asc(qrOrders.qrOrderId));
    const ids = orders.map(order => Number(order.qrOrderId));
    const items = ids.length ? await db.select({ qrOrderId: qrOrderItems.qrOrderId, qrOrderItemId: qrOrderItems.qrOrderItemId,
      menuId: qrOrderItems.menuId, itemName: qrOrderItems.itemName, qty: qrOrderItems.qty, unitPrice: qrOrderItems.unitPrice,
      totalAmount: qrOrderItems.totalAmount }).from(qrOrderItems).where(inArray(qrOrderItems.qrOrderId, ids)).orderBy(asc(qrOrderItems.qrOrderItemId)) : [];
    const itemIds = items.map(item => Number(item.qrOrderItemId));
    const options = itemIds.length ? await db.select({ qrOrderItemId: qrOrderItemOptions.qrOrderItemId,
      optionName: qrOrderItemOptions.optionName, qty: qrOrderItemOptions.qty, totalAmount: qrOrderItemOptions.totalAmount })
      .from(qrOrderItemOptions).where(inArray(qrOrderItemOptions.qrOrderItemId, itemIds)) : [];
    const taskByItem = new Map<number, { status: string; timerMinutes: number | null; timerStartedAtMs: number | null; kind: string }>();
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
    if (acceptedIds.length) {
      const [tasks] = await pool.query<KdsTaskRow[]>(
        `SELECT order_id AS orderId, member_items AS memberItems, kind, status,
          post_cook_timer_minutes AS postCookTimerMinutes, post_cook_timer_started_at_ms AS postCookTimerStartedAtMs
         FROM kds_tasks WHERE order_id IN (${acceptedIds.map(() => "?").join(",")})`, acceptedIds);
      for (const task of tasks) {
        try {
          for (const memberItem of JSON.parse(task.memberItems) as Array<{ itemId?: number; kind?: string }>) {
            if (memberItem.kind !== "COMPONENT" && Number.isInteger(memberItem.itemId)) taskByItem.set(memberItem.itemId!, {
              status: task.status, timerMinutes: task.postCookTimerMinutes, timerStartedAtMs: task.postCookTimerStartedAtMs, kind: task.kind });
          }
        } catch { /* malformed historical KDS snapshot: omit progress for this task */ }
      }
    }
    const menuIds = [...new Set(items.map(item => Number(item.menuId)))];
    const menuKinds = menuIds.length ? await db.select({ menuId: menus.menuId, kdsKind: menus.kdsKind, postCookTimer: menus.kdsPostCookTimer })
      .from(menus).where(inArray(menus.menuId, menuIds)) : [];
    const kindByMenu = new Map(menuKinds.map(menu => [Number(menu.menuId), { kdsKind: menu.kdsKind, postCookTimer: menu.postCookTimer === 1 }]));
    const stageItems = items.map(item => {
      const kds = taskByItem.get(standardItemByQrItem.get(Number(item.qrOrderItemId)) ?? -1);
      const menu = kindByMenu.get(Number(item.menuId));
      const stage = !menu || menu.kdsKind === "NONE" ? null : !kds ? "WAITING" : kds.status;
      const timerEndsAtMs = kds?.status === "DONE" && menu?.postCookTimer && kds.timerMinutes && kds.timerStartedAtMs
        ? kds.timerStartedAtMs + (kds.timerMinutes * 60 + 30) * 1000 : null;
      return { ...item, qrOrderItemId: Number(item.qrOrderItemId), qty: Number(item.qty), options: options.filter(option => Number(option.qrOrderItemId) === Number(item.qrOrderItemId)),
        kdsKind: menu?.kdsKind ?? "NONE", stage, timerEndsAtMs };
    });
    return Response.json({ success: true, tableNo: member.tableNo, capacity: member.capacity, qrSessionId: member.qrSessionId, isTest: member.isTest, canViewOrders: member.canViewOrders, needsJoin: Boolean(occupiedTable),
      serverNow: Date.now(), orders, items: stageItems }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "주문내역을 불러오지 못했습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
