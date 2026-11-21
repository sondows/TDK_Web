import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, diningTables, qrCodes, qrOrderItemOptions, qrOrderItems, qrOrders, qrSessions, qrTableLinks, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getCurrentHosStaff } from "@/lib/hos-auth";
import { totalQrOrderAmount } from "@/lib/qr-order-history-model";
import { QR_ORDER_ACCESS_MAX_AGE_SECONDS } from "@/lib/qr-order-auth";
import { canHideRejectedQrOrder } from "@/lib/qr-processing-policy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const staff = await getCurrentStaff() ?? await getCurrentHosStaff();
  if (!staff) return Response.json({ success: false }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const tableId = Number(new URL(request.url).searchParams.get("tableId"));
  if (!Number.isSafeInteger(tableId) || tableId <= 0) {
    return Response.json({ success: false, message: "유효한 테이블을 지정해 주세요." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const orders = await db.select({ qrOrderId: qrOrders.qrOrderId, status: qrOrders.status,
      totalAmount: qrOrders.totalAmount, orderedAt: sql<string>`DATE_FORMAT(${qrOrders.orderedAt}, '%Y-%m-%dT%H:%i:%s')`,
      acceptedAt: sql<string | null>`DATE_FORMAT(${qrOrders.acceptedAt}, '%Y-%m-%dT%H:%i:%s')`,
      rejectedAt: sql<string | null>`DATE_FORMAT(${qrOrders.rejectedAt}, '%Y-%m-%dT%H:%i:%s')`, note: qrOrders.note })
      .from(qrOrders).innerJoin(qrSessions, eq(qrSessions.qrSessionId, qrOrders.qrSessionId))
      .leftJoin(tableSessions, eq(tableSessions.sessionId, qrSessions.sessionId))
      .innerJoin(diningTables, eq(diningTables.tableId, sql`COALESCE(${tableSessions.tableId}, ${qrSessions.tableId})`))
      .innerJoin(qrTableLinks, eq(qrTableLinks.tableId, diningTables.tableId))
      .innerJoin(qrCodes, eq(qrCodes.qrCodeId, qrTableLinks.qrCodeId))
      .where(and(eq(diningTables.tableId, tableId), eq(diningTables.isActive, 1), eq(qrSessions.status, "ACTIVE"),
        or(
          and(isNull(qrSessions.sessionId), sql`${qrSessions.createdAt} >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${QR_ORDER_ACCESS_MAX_AGE_SECONDS} SECOND)`),
          and(isNotNull(qrSessions.sessionId), sql`EXISTS (
            SELECT 1
            FROM qr_orders first_order
            INNER JOIN qr_sessions first_qr ON first_qr.qr_session_id = first_order.qr_session_id
            WHERE first_qr.session_id = ${qrSessions.sessionId}
              AND first_order.status = 'ACCEPTED'
              AND first_order.qr_order_id = (
                SELECT earliest_order.qr_order_id
                FROM qr_orders earliest_order
                INNER JOIN qr_sessions earliest_qr ON earliest_qr.qr_session_id = earliest_order.qr_session_id
                WHERE earliest_qr.session_id = ${qrSessions.sessionId}
                  AND earliest_order.status = 'ACCEPTED'
                ORDER BY earliest_order.accepted_at ASC, earliest_order.qr_order_id ASC
                LIMIT 1
              )
              AND first_qr.created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${QR_ORDER_ACCESS_MAX_AGE_SECONDS} SECOND)
          )`),
          eq(qrOrders.status, "PENDING"))!,
        or(and(isNull(qrSessions.sessionId), eq(qrSessions.tableId, tableId)),
          and(eq(tableSessions.tableId, tableId), eq(tableSessions.status, "OPEN"), eq(tableSessions.sessionKind, "DINE_IN"))),
        eq(qrCodes.targetType, "TABLE_ORDER"), eq(qrCodes.status, "IN_USE"),
        sql`NOT EXISTS (SELECT 1 FROM audit_logs qr_order_hidden
          WHERE qr_order_hidden.action_type = 'QR_ORDER_HIDE'
            AND qr_order_hidden.entity_type = 'QR_ORDER'
            AND qr_order_hidden.entity_id = ${qrOrders.qrOrderId})`))
      .orderBy(desc(qrOrders.orderedAt), desc(qrOrders.qrOrderId));

    const orderIds = orders.map(order => Number(order.qrOrderId));
    const items = orderIds.length ? await db.select({ qrOrderId: qrOrderItems.qrOrderId,
      qrOrderItemId: qrOrderItems.qrOrderItemId, itemName: qrOrderItems.itemName, qty: qrOrderItems.qty,
      unitPrice: qrOrderItems.unitPrice, totalAmount: qrOrderItems.totalAmount, note: qrOrderItems.note })
      .from(qrOrderItems).where(inArray(qrOrderItems.qrOrderId, orderIds))
      .orderBy(asc(qrOrderItems.qrOrderItemId)) : [];
    const itemIds = items.map(item => Number(item.qrOrderItemId));
    const options = itemIds.length ? await db.select({ qrOrderItemId: qrOrderItemOptions.qrOrderItemId,
      optionName: qrOrderItemOptions.optionName, qty: qrOrderItemOptions.qty, totalAmount: qrOrderItemOptions.totalAmount })
      .from(qrOrderItemOptions).where(inArray(qrOrderItemOptions.qrOrderItemId, itemIds)) : [];

    const resultOrders = orders.map(order => ({ ...order, qrOrderId: Number(order.qrOrderId),
      items: items.filter(item => Number(item.qrOrderId) === Number(order.qrOrderId)).map(item => ({
        ...item, qrOrderItemId: Number(item.qrOrderItemId), qty: Number(item.qty),
        options: options.filter(option => Number(option.qrOrderItemId) === Number(item.qrOrderItemId))
          .map(option => ({ ...option, qty: Number(option.qty) })),
      })),
    }));

    return Response.json({ success: true, orders: resultOrders,
      orderCount: resultOrders.length, totalAmount: totalQrOrderAmount(orders) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("QR staff order history unavailable", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "QR 주문내역을 불러오지 못했습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(request: Request) {
  const staff = await getCurrentStaff() ?? await getCurrentHosStaff();
  if (!staff) return Response.json({ success: false }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const body = await request.json().catch(() => null) as { qrOrderId?: unknown } | null;
  const qrOrderId = Number(body?.qrOrderId);
  if (!Number.isSafeInteger(qrOrderId) || qrOrderId <= 0) {
    return Response.json({ success: false, message: "유효한 QR 주문을 지정해 주세요." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const result = await db.transaction(async tx => {
      const [order] = await tx.select({ qrOrderId: qrOrders.qrOrderId, status: qrOrders.status })
        .from(qrOrders).where(eq(qrOrders.qrOrderId, qrOrderId)).for("update").limit(1);
      if (!order) return { kind: "NOT_FOUND" as const };
      if (!canHideRejectedQrOrder(order.status)) return { kind: "NOT_REJECTED" as const };
      const [existing] = await tx.select({ auditLogId: auditLogs.auditLogId }).from(auditLogs)
        .where(and(eq(auditLogs.actionType, "QR_ORDER_HIDE"), eq(auditLogs.entityType, "QR_ORDER"), eq(auditLogs.entityId, qrOrderId)))
        .limit(1);
      if (existing) return { kind: "ALREADY_HIDDEN" as const };
      await tx.insert(auditLogs).values({ staffId: staff.staffId, actionType: "QR_ORDER_HIDE", entityType: "QR_ORDER",
        entityId: qrOrderId, description: "Hidden rejected QR order from staff history" });
      return { kind: "HIDDEN" as const };
    });

    if (result.kind === "NOT_FOUND") return Response.json({ success: false, message: "QR 주문을 찾을 수 없습니다." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    if (result.kind === "NOT_REJECTED") return Response.json({ success: false, message: "거절된 QR 주문만 목록에서 숨길 수 있습니다." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    return Response.json({ success: true, hidden: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("QR rejected order hide failed", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "거절된 QR 주문을 목록에서 숨기지 못했습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
