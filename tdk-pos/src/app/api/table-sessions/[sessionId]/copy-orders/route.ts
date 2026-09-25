import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  diningTables,
  orderItemCancellations,
  orderItemOptions,
  orderItems,
  orders,
  partyGroups,
  tableSessionMerges,
  tableSessions,
} from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";

const CENTS = BigInt(100);

function cents(value: string) {
  const match = /^(-?\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error("INVALID_DECIMAL");
  return BigInt(match[1]) * CENTS + BigInt((match[2] ?? "").padEnd(2, "0"));
}

function decimal(value: bigint) {
  const sign = value < 0 ? "-" : "";
  const amount = value < 0 ? -value : value;
  return sign + (amount / CENTS).toString() + "." + (amount % CENTS).toString().padStart(2, "0");
}

function destinationTableIds(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return null;
  const ids = [...new Set(value.map(Number))];
  return ids.length === value.length && ids.every(id => Number.isInteger(id) && id > 0) ? ids : null;
}

class CopyValidationError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const currentStaff = await getCurrentStaff();
    const sharedMode = await getPosLoginMode() === "SHARED";
    if (!currentStaff && !sharedMode) {
      return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
    }

    const { sessionId: rawSessionId } = await params;
    const sourceSessionId = Number(rawSessionId);
    const body = await request.json() as { destinationTableIds?: unknown };
    const destinations = destinationTableIds(body.destinationTableIds);
    if (!Number.isInteger(sourceSessionId) || sourceSessionId <= 0 || !destinations) {
      return Response.json({ success: false, message: "주문 복사 요청이 올바르지 않습니다." }, { status: 400 });
    }

    const result = await db.transaction(async tx => {
      const [source] = await tx.select({
        sessionId: tableSessions.sessionId,
        tableId: tableSessions.tableId,
        groupId: tableSessions.groupId,
        personCount: tableSessions.personCount,
        babyCount: tableSessions.babyCount,
        tableNo: diningTables.tableNo,
      }).from(tableSessions).innerJoin(diningTables, eq(tableSessions.tableId, diningTables.tableId))
        .where(and(eq(tableSessions.sessionId, sourceSessionId), eq(tableSessions.status, "OPEN"))).limit(1);
      if (!source) throw new CopyValidationError("사용 중인 테이블을 선택해 주세요.");
      if (destinations.includes(source.tableId)) throw new CopyValidationError("원본 테이블은 복사 대상으로 선택할 수 없습니다.");

      await tx.execute(sql`SELECT session_id FROM table_sessions WHERE session_id = ${sourceSessionId} FOR UPDATE`);
      const sourceMerges = await tx.select({ mergeId: tableSessionMerges.mergeId }).from(tableSessionMerges)
        .where(and(eq(tableSessionMerges.status, "ACTIVE"), sql`(${tableSessionMerges.sourceSessionId} = ${sourceSessionId} OR ${tableSessionMerges.destinationSessionId} = ${sourceSessionId})`));
      if (sourceMerges.length) throw new CopyValidationError("합석 중인 테이블은 합석 분리 후 주문을 복사해 주세요.");

      const destinationRows = await tx.select({ tableId: diningTables.tableId, tableNo: diningTables.tableNo })
        .from(diningTables).where(and(inArray(diningTables.tableId, destinations), eq(diningTables.isActive, 1)));
      if (destinationRows.length !== destinations.length) throw new CopyValidationError("선택한 테이블을 찾을 수 없습니다.", 404);
      await tx.execute(sql`SELECT table_id FROM dining_tables WHERE ${inArray(diningTables.tableId, destinations)} FOR UPDATE`);

      const openDestinationSessions = await tx.select({ sessionId: tableSessions.sessionId, tableId: tableSessions.tableId })
        .from(tableSessions).where(and(inArray(tableSessions.tableId, destinations), eq(tableSessions.status, "OPEN")));
      if (openDestinationSessions.length) throw new CopyValidationError("테이블 상태가 변경되었습니다. 빈 테이블을 다시 선택해 주세요.");

      const sourceOrders = await tx.select({ orderId: orders.orderId, status: orders.status })
        .from(orders).where(eq(orders.sessionId, sourceSessionId));
      const eligibleOrderIds = sourceOrders.filter(order => order.status === "OPEN" || order.status === "ACCEPTED").map(order => order.orderId);
      const sourceItems = eligibleOrderIds.length ? await tx.select({
        orderItemId: orderItems.orderItemId, orderId: orderItems.orderId, menuId: orderItems.menuId,
        itemName: orderItems.itemName, qty: orderItems.qty, unitPrice: orderItems.unitPrice,
        prepStationId: orderItems.prepStationId, itemType: orderItems.itemType, status: orderItems.status, printOnReceipt: orderItems.printOnReceipt, note: orderItems.note,
      }).from(orderItems).where(inArray(orderItems.orderId, eligibleOrderIds)) : [];
      const cancellationRows = sourceItems.length ? await tx.select({ orderItemId: orderItemCancellations.orderItemId, cancelledQty: orderItemCancellations.cancelledQty })
        .from(orderItemCancellations).where(inArray(orderItemCancellations.orderItemId, sourceItems.map(item => item.orderItemId))) : [];
      const cancelledByItem = new Map<number, number>();
      cancellationRows.forEach(row => cancelledByItem.set(row.orderItemId, (cancelledByItem.get(row.orderItemId) ?? 0) + row.cancelledQty));
      const effectiveItems = sourceItems.map(item => ({ ...item, effectiveQty: item.qty - (cancelledByItem.get(item.orderItemId) ?? 0) }))
        .filter(item => item.status !== "CANCELLED" && item.effectiveQty > 0);
      if (!effectiveItems.length) throw new CopyValidationError("복사할 주문이 없습니다.");

      const sourceOptions = await tx.select({
        orderItemId: orderItemOptions.orderItemId, modifierOptionId: orderItemOptions.modifierOptionId,
        optionName: orderItemOptions.optionName, qty: orderItemOptions.qty, unitPrice: orderItemOptions.unitPrice, totalAmount: orderItemOptions.totalAmount,
      }).from(orderItemOptions).where(inArray(orderItemOptions.orderItemId, effectiveItems.map(item => item.orderItemId)));
      const optionsByItem = new Map<number, typeof sourceOptions>();
      sourceOptions.forEach(option => optionsByItem.set(option.orderItemId, [...(optionsByItem.get(option.orderItemId) ?? []), option]));

      let groupId = source.groupId;
      if (groupId === null) {
        const [groupInsert] = await tx.insert(partyGroups).values({ status: "ACTIVE", createdByStaffId: currentStaff?.staffId ?? null });
        groupId = Number(groupInsert.insertId);
        await tx.update(tableSessions).set({ groupId }).where(and(eq(tableSessions.sessionId, sourceSessionId), eq(tableSessions.status, "OPEN")));
      } else {
        const [group] = await tx.select({ groupId: partyGroups.groupId }).from(partyGroups)
          .where(and(eq(partyGroups.groupId, groupId), eq(partyGroups.status, "ACTIVE"))).limit(1);
        if (!group) throw new CopyValidationError("일행 정보가 변경되었습니다. 다시 선택해 주세요.");
      }

      const totalCents = effectiveItems.reduce((sum, item) => sum + cents(item.unitPrice) * BigInt(item.effectiveQty), BigInt(0));
      const totalAmount = decimal(totalCents);
      const tableNoById = new Map(destinationRows.map(table => [table.tableId, table.tableNo]));

      for (const destinationTableId of destinations) {
        const [sessionInsert] = await tx.insert(tableSessions).values({
          tableId: destinationTableId,
          groupId,
          personCount: source.personCount,
          babyCount: source.babyCount,
          status: "OPEN",
          openedByStaffId: currentStaff?.staffId ?? null,
        });
        const destinationSessionId = Number(sessionInsert.insertId);
        const [orderInsert] = await tx.insert(orders).values({
          sessionId: destinationSessionId,
          orderType: "POS",
          status: "ACCEPTED",
          subtotalAmount: totalAmount,
          discountAmount: "0.00",
          totalAmount,
          createdByStaffId: currentStaff?.staffId ?? null,
          acceptedByStaffId: currentStaff?.staffId ?? null,
          acceptedAt: new Date(),
        });
        const destinationOrderId = Number(orderInsert.insertId);
        for (const item of effectiveItems) {
          const itemTotal = decimal(cents(item.unitPrice) * BigInt(item.effectiveQty));
          const [itemInsert] = await tx.insert(orderItems).values({
            orderId: destinationOrderId,
            menuId: item.menuId,
            itemName: item.itemName,
            qty: item.effectiveQty,
            unitPrice: item.unitPrice,
            discountAmount: "0.00",
            totalAmount: itemTotal,
            prepStationId: item.prepStationId,
            itemType: item.itemType,
            status: "ORDERED",
            printOnReceipt: item.printOnReceipt,
            note: item.note,
          });
          const destinationItemId = Number(itemInsert.insertId);
          const options = optionsByItem.get(item.orderItemId) ?? [];
          if (options.length) await tx.insert(orderItemOptions).values(options.map(option => ({
            orderItemId: destinationItemId,
            modifierOptionId: option.modifierOptionId,
            optionName: option.optionName,
            qty: option.qty,
            unitPrice: option.unitPrice,
            totalAmount: option.totalAmount,
          })));
        }
      }

      return { sourceTableNo: source.tableNo, destinationTableNos: destinations.map(id => tableNoById.get(id) ?? String(id)) };
    });

    return Response.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof CopyValidationError) return Response.json({ success: false, message: error.message }, { status: error.status });
    console.error("order copy failed", error);
    return Response.json({ success: false, message: "주문 복사 처리에 실패했습니다." }, { status: 500 });
  }
}
