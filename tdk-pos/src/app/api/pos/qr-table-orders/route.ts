import { and, asc, eq, inArray, isNull, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { diningTables, qrCodes, qrOrderItemOptions, qrOrderItems, qrOrders, qrSessions, qrTableLinks, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getCurrentHosStaff } from "@/lib/hos-auth";
import { assignQrOrderRoundNumbers } from "@/lib/qr-pending-order-rounds";
import { DailyOpeningRequiredError, ensureDailyOpeningCash } from "@/lib/daily-opening-cash";
import { buildWaitOrderSnapshots, insertWaitOrderAsPosOrder, type WaitOrderInputItem } from "@/lib/qr-wait-pos-order";
import { canAdoptQrOrderSession, canProcessQrOrder } from "@/lib/qr-processing-policy";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await getCurrentStaff() ?? await getCurrentHosStaff();
  if (!staff) return Response.json({ success: false }, { status: 401 });
  try {
    const rows = await db.select({ qrOrderId: qrOrders.qrOrderId, status: qrOrders.status, tableId: diningTables.tableId,
      tableNo: diningTables.tableNo, sessionId: qrSessions.sessionId, qrSessionId: qrOrders.qrSessionId, languageCode: qrSessions.languageCode,
      totalAmount: qrOrders.totalAmount,
      orderedAt: sql<string>`DATE_FORMAT(${qrOrders.orderedAt}, '%Y-%m-%dT%H:%i:%s')`, note: qrOrders.note })
      .from(qrOrders).innerJoin(qrSessions, eq(qrSessions.qrSessionId, qrOrders.qrSessionId))
      .leftJoin(tableSessions, eq(tableSessions.sessionId, qrSessions.sessionId))
      .innerJoin(diningTables, eq(diningTables.tableId, sql`COALESCE(${tableSessions.tableId}, ${qrSessions.tableId})`))
      .where(and(eq(diningTables.isActive, 1), or(
        and(eq(qrSessions.status, "ACTIVE"), or(
          and(isNull(qrSessions.sessionId), isNotNull(qrSessions.tableId)),
          and(eq(tableSessions.status, "OPEN"), eq(tableSessions.sessionKind, "DINE_IN")),
        )),
        and(inArray(qrOrders.status, ["ACCEPTED", "REJECTED", "CANCELLED"]),
          eq(tableSessions.status, "OPEN"), eq(tableSessions.sessionKind, "DINE_IN")),
      )))
      .orderBy(asc(qrOrders.orderedAt), asc(qrOrders.qrOrderId));
    const numberedOrders = assignQrOrderRoundNumbers(rows.map(row => ({ ...row, qrOrderId: Number(row.qrOrderId),
      tableId: Number(row.tableId), sessionId: row.sessionId === null ? null : Number(row.sessionId) })));
    const pendingOrders = numberedOrders.filter(order => order.status === "PENDING");
    const ids = pendingOrders.map(order => order.qrOrderId);
    const items = ids.length ? await db.select({ qrOrderId: qrOrderItems.qrOrderId, qrOrderItemId: qrOrderItems.qrOrderItemId,
      menuId: qrOrderItems.menuId, itemName: qrOrderItems.itemName, qty: qrOrderItems.qty, totalAmount: qrOrderItems.totalAmount })
      .from(qrOrderItems).where(inArray(qrOrderItems.qrOrderId, ids)).orderBy(asc(qrOrderItems.qrOrderItemId)) : [];
    const itemIds = items.map(item => Number(item.qrOrderItemId));
    const options = itemIds.length ? await db.select({ qrOrderItemId: qrOrderItemOptions.qrOrderItemId,
      optionName: qrOrderItemOptions.optionName, qty: qrOrderItemOptions.qty, totalAmount: qrOrderItemOptions.totalAmount }).from(qrOrderItemOptions)
      .where(inArray(qrOrderItemOptions.qrOrderItemId, itemIds)) : [];
    const orders = pendingOrders.map(order => ({ ...order,
      qrSessionId: Number(order.qrSessionId), totalAmount: String(order.totalAmount),
      items: items.filter(item => Number(item.qrOrderId) === order.qrOrderId).map(item => ({ ...item,
        qrOrderItemId: Number(item.qrOrderItemId), menuId: Number(item.menuId), qty: Number(item.qty), totalAmount: String(item.totalAmount),
        options: options.filter(option => Number(option.qrOrderItemId) === Number(item.qrOrderItemId)).map(option => ({
          ...option, qty: Number(option.qty), totalAmount: String(option.totalAmount),
        })) })) }));
    return Response.json({ success: true, orders }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "QR 주문 대기 목록을 불러오지 못했습니다." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const staff = await getCurrentStaff() ?? await getCurrentHosStaff();
  if (!staff) return Response.json({ success: false }, { status: 401 });
  const body = await request.json().catch(() => null) as { qrOrderId?: unknown; action?: unknown } | null;
  const id = Number(body?.qrOrderId);
  if (!Number.isSafeInteger(id) || id <= 0 || (body?.action !== "ACCEPT" && body?.action !== "REJECT")) return Response.json({ success: false }, { status: 400 });
  try {
    const result = await db.transaction(async tx => {
      const [order] = await tx.select({ qrOrderId: qrOrders.qrOrderId, status: qrOrders.status, qrSessionId: qrOrders.qrSessionId,
        submittedTotal: qrOrders.totalAmount })
        .from(qrOrders).where(eq(qrOrders.qrOrderId, id)).for("update").limit(1);
      if (!order || !canProcessQrOrder(order.status)) return { kind: "CONFLICT" as const };
      const now = new Date();
      if (body.action === "REJECT") {
        await tx.update(qrOrders).set({ status: "REJECTED", rejectedAt: now }).where(and(eq(qrOrders.qrOrderId, id), eq(qrOrders.status, "PENDING")));
        return { kind: "REJECTED" as const };
      }
      const [snapshot] = await tx.select({ sessionId: qrSessions.sessionId, qrTableId: qrSessions.tableId, status: qrSessions.status })
        .from(qrSessions).where(eq(qrSessions.qrSessionId, order.qrSessionId)).limit(1);
      if (!snapshot || snapshot.status !== "ACTIVE") return { kind: "CLOSED" as const };
      const snapshotTableId = snapshot.sessionId
        ? (await tx.select({ tableId: tableSessions.tableId }).from(tableSessions).where(eq(tableSessions.sessionId, snapshot.sessionId)).limit(1))[0]?.tableId
        : snapshot.qrTableId;
      const tableId = Number(snapshotTableId);
      if (!Number.isSafeInteger(tableId) || tableId <= 0) return { kind: "CLOSED" as const };
      if (snapshot.sessionId === null) await ensureDailyOpeningCash(tx);
      const [table] = await tx.select({ tableId: diningTables.tableId }).from(diningTables)
        .where(and(eq(diningTables.tableId, tableId), eq(diningTables.isActive, 1))).for("update").limit(1);
      if (!table) return { kind: "CLOSED" as const };
      const openSessions = await tx.select({ sessionId: tableSessions.sessionId, tableId: tableSessions.tableId })
        .from(tableSessions).where(and(eq(tableSessions.tableId, tableId), eq(tableSessions.sessionKind, "DINE_IN"), eq(tableSessions.status, "OPEN"))).for("update");
      const [customer] = await tx.select({ qrSessionId: qrSessions.qrSessionId, sessionId: qrSessions.sessionId, tableId: qrSessions.tableId, status: qrSessions.status })
        .from(qrSessions).where(eq(qrSessions.qrSessionId, order.qrSessionId)).for("update").limit(1);
      if (!customer || customer.status !== "ACTIVE") return { kind: "CLOSED" as const };
      if (customer.sessionId !== null && !openSessions.some(session => Number(customer.sessionId) === Number(session.sessionId))) return { kind: "CLOSED" as const };
      if (customer.sessionId === null && openSessions.length > 0) {
        await tx.update(qrOrders).set({ status: "REJECTED", rejectedAt: now, note: "다른 주문으로 테이블 이용이 시작되었습니다. 기존 고객에게 일행 초대를 요청해 주세요." })
          .where(and(eq(qrOrders.qrOrderId, id), eq(qrOrders.status, "PENDING")));
        return { kind: "SESSION_CONFLICT" as const };
      }
      const [activeQr] = await tx.select({ qrCodeId: qrCodes.qrCodeId }).from(qrTableLinks)
        .innerJoin(qrCodes, eq(qrCodes.qrCodeId, qrTableLinks.qrCodeId))
        .where(and(eq(qrTableLinks.tableId, tableId), eq(qrCodes.status, "IN_USE"), eq(qrCodes.targetType, "TABLE_ORDER"))).limit(1);
      if (!activeQr) return { kind: "QR_INVALID" as const };

      let sessionId = customer.sessionId === null ? 0 : Number(customer.sessionId);

      const itemRows = await tx.select({ qrOrderItemId: qrOrderItems.qrOrderItemId, menuId: qrOrderItems.menuId, qty: qrOrderItems.qty })
        .from(qrOrderItems).where(eq(qrOrderItems.qrOrderId, id)).orderBy(asc(qrOrderItems.qrOrderItemId));
      if (!itemRows.length) return { kind: "EMPTY" as const };
      const itemIds = itemRows.map(item => Number(item.qrOrderItemId));
      const optionRows = await tx.select({ qrOrderItemId: qrOrderItemOptions.qrOrderItemId, modifierOptionId: qrOrderItemOptions.modifierOptionId, qty: qrOrderItemOptions.qty })
        .from(qrOrderItemOptions).where(inArray(qrOrderItemOptions.qrOrderItemId, itemIds));
      if (optionRows.some(option => option.modifierOptionId === null)) return { kind: "STALE" as const };
      const input: WaitOrderInputItem[] = itemRows.map(item => ({ menuId: Number(item.menuId), qty: Number(item.qty),
        options: optionRows.filter(option => Number(option.qrOrderItemId) === Number(item.qrOrderItemId))
          .map(option => ({ modifierOptionId: Number(option.modifierOptionId), qty: Number(option.qty) })) }));
      const snapshots = await buildWaitOrderSnapshots(tx, input);
      if (Math.abs(Number(snapshots.total) - Number(order.submittedTotal)) >= 0.01) return { kind: "PRICE_CHANGED" as const };

      if (sessionId === 0) {
        const pendingQrSessions = await tx.select({ qrSessionId: qrSessions.qrSessionId, sessionId: qrSessions.sessionId,
          tableId: qrSessions.tableId, status: qrSessions.status }).from(qrSessions)
          .where(and(eq(qrSessions.tableId, tableId), eq(qrSessions.status, "ACTIVE"), isNull(qrSessions.sessionId),
            sql`EXISTS (SELECT 1 FROM qr_orders pending_order WHERE pending_order.qr_session_id = ${qrSessions.qrSessionId} AND pending_order.status = 'PENDING')`))
          .orderBy(asc(qrSessions.qrSessionId)).for("update");
        const sessionsToBind = pendingQrSessions.filter(candidate => canAdoptQrOrderSession({
          candidateTableId: Number(candidate.tableId), targetTableId: tableId,
          candidateSessionId: candidate.sessionId === null ? null : Number(candidate.sessionId),
          qrSessionStatus: candidate.status, hasPendingOrder: true, hasOpenTableSession: false,
        }));
        const sessionIdsToBind = sessionsToBind.map(candidate => Number(candidate.qrSessionId));
        if (!sessionIdsToBind.includes(Number(customer.qrSessionId))) return { kind: "CLOSED" as const };
        const [createdSession] = await tx.insert(tableSessions).values({ tableId, personCount: 0, babyCount: 0,
          status: "OPEN", openedByStaffId: staff.staffId, sessionKind: "DINE_IN" });
        sessionId = Number(createdSession.insertId);
        const bound = await tx.update(qrSessions).set({ sessionId, tableId, lastActiveAt: now })
          .where(and(inArray(qrSessions.qrSessionId, sessionIdsToBind), eq(qrSessions.status, "ACTIVE"), isNull(qrSessions.sessionId)));
        if (bound[0].affectedRows !== sessionIdsToBind.length) throw new Error("QR_SESSION_BIND_FAILED");
      }
      const acceptedOrderId = await insertWaitOrderAsPosOrder(tx, sessionId, staff.staffId, snapshots.snapshots, snapshots.total);
      await tx.update(qrOrders).set({ status: "ACCEPTED", acceptedOrderId, acceptedAt: now, acceptedByStaffId: staff.staffId })
        .where(and(eq(qrOrders.qrOrderId, id), eq(qrOrders.status, "PENDING")));
      return { kind: "ACCEPTED" as const, acceptedOrderId };
    });
    if (result.kind === "REJECTED" || result.kind === "ACCEPTED") return Response.json({ success: true, acceptedOrderId: result.kind === "ACCEPTED" ? result.acceptedOrderId : null });
    const message = result.kind === "CLOSED" ? "고객 세션이 만료되었거나 테이블 이용이 종료되었습니다."
      : result.kind === "QR_INVALID" ? "QR이 폐기되었거나 테이블 연결이 변경되었습니다."
        : result.kind === "SESSION_CONFLICT" ? "다른 고객의 주문으로 테이블 이용이 먼저 시작되어 이 주문은 반려되었습니다. 고객에게 일행 초대를 안내해 주세요."
          : result.kind === "PRICE_CHANGED" ? "등록 이후 가격이 변경되어 승인하지 않았습니다. 새 가격을 고객에게 확인해 주세요."
            : result.kind === "STALE" ? "메뉴 또는 옵션 설정이 변경되어 다시 확인해야 합니다." : "이 QR 주문을 처리할 수 없습니다.";
    return Response.json({ success: false, message }, { status: result.kind === "CONFLICT" || result.kind === "PRICE_CHANGED" || result.kind === "SESSION_CONFLICT" ? 409 : 422 });
  } catch (error) {
    if (error instanceof DailyOpeningRequiredError) return Response.json({ success: false, openingRequired: true, message: error.message }, { status: 428 });
    return Response.json({ success: false, message: "QR 주문 처리에 실패했습니다." }, { status: 503 });
  }
}
