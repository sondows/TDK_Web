import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { checkoutItems, customerPrepaidLedger, customers, orderItemCancellations, orderItems, orders, paymentSessionAllocations, payments, staff as staffTable, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { takeoutLabel } from "@/lib/takeout-label";
import { syncRiceOrderItemStock } from "@/lib/rice-stock";
import { isValidPickupAt, pickupAtAfterMinutes } from "@/lib/phone-takeout-time";
import { defaultTakeoutPreparationMinutes, getTakeoutPreparationMinutes } from "@/lib/takeout-preparation-setting";
import { hasOutstandingTakeoutPayment } from "@/lib/takeout-cancellation-payment";
import { BusinessOpeningRequiredError, BusinessSessionConflictError, ensureBusinessSession } from "@/lib/business-session";

export const dynamic = "force-dynamic";

async function actor() {
  const staff = await getCurrentStaff();
  if (!staff && await getPosLoginMode() !== "SHARED") return null;
  return staff;
}

export async function GET() {
  if (!await actor() && await getPosLoginMode() !== "SHARED")
    return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  const sessions = await db.select({
    sessionId: tableSessions.sessionId,
    kind: tableSessions.sessionKind,
    displayName: tableSessions.displayName,
    openedAt: tableSessions.openedAt,
    pickupAt: sql<string | null>`DATE_FORMAT(${tableSessions.pickupAt}, '%Y-%m-%d %H:%i:%s')`,
    pickupPhone: tableSessions.pickupPhone,
    pickupCustomerId: tableSessions.pickupCustomerId,
    pickupCustomerName: sql<string | null>`COALESCE(${customers.name}, ${tableSessions.pickupName})`,
  }).from(tableSessions).leftJoin(customers, eq(tableSessions.pickupCustomerId, customers.customerId)).where(and(eq(tableSessions.status, "OPEN"), sql`${tableSessions.sessionKind} <> 'DINE_IN'`)).orderBy(tableSessions.sessionId);
  return Response.json({ success: true, sessions: sessions.map(session => ({ ...session, openedAt: session.openedAt.toISOString() })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const staff = await actor();
  if (!staff && await getPosLoginMode() !== "SHARED")
    return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { kind?: unknown; requestKey?: unknown; pickupAt?: unknown; pickupPhone?: unknown; pickupCustomerId?: unknown };
  if (body.kind !== "TAKEOUT_WALK_IN" && body.kind !== "TAKEOUT_PHONE")
    return Response.json({ success: false, message: "포장 유형을 확인해 주세요." }, { status: 400 });
  if (typeof body.requestKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestKey))
    return Response.json({ success: false, message: "생성 요청을 확인해 주세요." }, { status: 400 });
  const existingRequest = async () => {
    const [existing] = await db.select({
      sessionId: tableSessions.sessionId, kind: tableSessions.sessionKind, displayName: tableSessions.displayName,
      status: tableSessions.status, openedAt: tableSessions.openedAt,
      pickupAt: sql<string | null>`DATE_FORMAT(${tableSessions.pickupAt}, '%Y-%m-%d %H:%i:%s')`,
      pickupPhone: tableSessions.pickupPhone, pickupCustomerId: tableSessions.pickupCustomerId,
      pickupCustomerName: sql<string | null>`COALESCE(${customers.name}, ${tableSessions.pickupName})`,
    }).from(tableSessions).leftJoin(customers, eq(tableSessions.pickupCustomerId, customers.customerId))
      .where(eq(tableSessions.createRequestKey, body.requestKey as string)).limit(1);
    return existing?.displayName ? { ...existing, openedAt: existing.openedAt.toISOString() } : null;
  };
  const alreadyCreated = await existingRequest();
  if (alreadyCreated) return alreadyCreated.kind === body.kind && alreadyCreated.status === "OPEN"
    ? Response.json({ success: true, session: alreadyCreated })
    : Response.json({ success: false, message: "이미 처리된 생성 요청입니다." }, { status: 409 });
  let pickupCustomer: { customerId: number; name: string } | null = null;
  let pickupPhone: string | null = null;
  let pickupAt: string | null = null;
  const useDefaultPickupTime = body.pickupAt === undefined;
  const preparationMinutes = useDefaultPickupTime
    ? await getTakeoutPreparationMinutes().catch(error => {
      console.error("Takeout preparation setting lookup failed", error);
      return defaultTakeoutPreparationMinutes;
    })
    : defaultTakeoutPreparationMinutes;
  if (body.pickupAt !== undefined && body.pickupAt !== null) {
    if (!isValidPickupAt(body.pickupAt))
      return Response.json({ success: false, message: "찾는시간을 올바르게 지정해 주세요." }, { status: 400 });
    pickupAt = body.pickupAt;
  }
  if (body.pickupPhone !== undefined && body.pickupPhone !== null) {
    if (typeof body.pickupPhone !== "string" || !/^\d{1,15}$/.test(body.pickupPhone))
      return Response.json({ success: false, message: "전화번호를 확인해 주세요." }, { status: 400 });
    pickupPhone = body.pickupPhone;
  }
  if (body.pickupCustomerId !== undefined && body.pickupCustomerId !== null) {
    const customerId = Number(body.pickupCustomerId);
    if (!Number.isSafeInteger(customerId) || customerId <= 0)
      return Response.json({ success: false, message: "선택한 고객을 확인해 주세요." }, { status: 400 });
    [pickupCustomer] = await db.select({ customerId: customers.customerId, name: customers.name })
      .from(customers).where(and(eq(customers.customerId, customerId), eq(customers.isActive, 1))).limit(1);
    if (!pickupCustomer) return Response.json({ success: false, message: "선택한 고객을 찾을 수 없습니다." }, { status: 400 });
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await db.transaction(async tx => {
        const business = await ensureBusinessSession(tx);
        const [inserted] = await tx.insert(tableSessions).values({
          businessSessionId: business.businessSessionId,
          tableId: null,
          sessionKind: body.kind as "TAKEOUT_WALK_IN" | "TAKEOUT_PHONE",
          createRequestKey: body.requestKey as string,
          status: "OPEN",
          openedByStaffId: staff?.staffId,
          pickupPhone,
          pickupCustomerId: pickupCustomer?.customerId ?? null,
          pickupName: pickupCustomer?.name ?? null,
        });
        const sessionId = Number(inserted.insertId);
        const [stamp] = await tx.select({ date: sql<string>`DATE_FORMAT(${tableSessions.openedAt}, '%Y%m%d')`, time: sql<string>`DATE_FORMAT(${tableSessions.openedAt}, '%H%i')`, openedAt: tableSessions.openedAt }).from(tableSessions).where(eq(tableSessions.sessionId, sessionId));
        const effectivePickupAt = useDefaultPickupTime
          ? pickupAtAfterMinutes(stamp.openedAt, preparationMinutes)
          : pickupAt;
        const prefix = `${stamp.date}:T:${stamp.time}`;
        const [existing] = await tx.select({ count: sql<number>`COUNT(*)` }).from(tableSessions).where(sql`${tableSessions.takeoutLabelKey} LIKE ${`${prefix}:%`}`);
        const sequence = Number(existing.count) + 1;
        const displayName = takeoutLabel(stamp.time, sequence);
        await tx.update(tableSessions).set({
          displayName,
          takeoutLabelKey: `${prefix}:${sequence}`,
          ...(effectivePickupAt ? { pickupAt: sql`${effectivePickupAt}` } : {}),
        }).where(eq(tableSessions.sessionId, sessionId));
        return { sessionId, kind: body.kind, displayName, openedAt: stamp.openedAt.toISOString(), pickupAt: effectivePickupAt, pickupPhone, pickupCustomerId: pickupCustomer?.customerId ?? null, pickupCustomerName: pickupCustomer?.name ?? null };
      });
      return Response.json({ success: true, session: created }, { status: 201 });
    } catch (error) {
      if (error instanceof BusinessOpeningRequiredError) return Response.json({ success: false, openingRequired: true, message: error.message }, { status: 428 });
      if (error instanceof BusinessSessionConflictError) return Response.json({ success: false, message: error.message }, { status: 409 });
      const duplicate = (error as { code?: string; cause?: { code?: string } }).code === "ER_DUP_ENTRY" || (error as { cause?: { code?: string } }).cause?.code === "ER_DUP_ENTRY";
      if (duplicate) {
        const prior = await existingRequest();
        if (prior) return prior.kind === body.kind && prior.status === "OPEN"
          ? Response.json({ success: true, session: prior })
          : Response.json({ success: false, message: "이미 처리된 생성 요청입니다." }, { status: 409 });
        if (attempt < 4) continue;
      }
      console.error("Takeout creation failed", error);
      return Response.json({ success: false, message: "포장 주문을 만들지 못했습니다." }, { status: 500 });
    }
  }
  return Response.json({ success: false, message: "포장 주문 생성이 지연되었습니다. 다시 시도해 주세요." }, { status: 409 });
}

export async function PATCH(request: Request) {
  const staff = await actor();
  if (!staff && await getPosLoginMode() !== "SHARED")
    return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { sessionId?: unknown; pickupAt?: unknown; pickupPhone?: unknown; pickupCustomerId?: unknown };
  const sessionId = Number(body.sessionId);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0)
    return Response.json({ success: false, message: "포장 주문을 확인해 주세요." }, { status: 400 });
  if (body.pickupAt !== null && !isValidPickupAt(body.pickupAt))
    return Response.json({ success: false, message: "찾는시간을 올바르게 지정해 주세요." }, { status: 400 });
  if (body.pickupPhone !== null && (typeof body.pickupPhone !== "string" || !/^\d{1,15}$/.test(body.pickupPhone)))
    return Response.json({ success: false, message: "전화번호를 확인해 주세요." }, { status: 400 });
  const customerId = body.pickupCustomerId === null ? null : Number(body.pickupCustomerId);
  if (customerId !== null && (!Number.isSafeInteger(customerId) || customerId <= 0))
    return Response.json({ success: false, message: "선택한 고객을 확인해 주세요." }, { status: 400 });

  try {
    const updated = await db.transaction(async tx => {
      const [session] = await tx.select({ kind: tableSessions.sessionKind }).from(tableSessions)
        .where(and(eq(tableSessions.sessionId, sessionId), eq(tableSessions.status, "OPEN"))).for("update").limit(1);
      if (!session || session.kind === "DINE_IN") return null;
      const [customer] = customerId === null ? [] : await tx.select({ customerId: customers.customerId, name: customers.name })
        .from(customers).where(and(eq(customers.customerId, customerId), eq(customers.isActive, 1))).limit(1);
      if (customerId !== null && !customer) throw new Error("선택한 고객을 찾을 수 없습니다.");
      await tx.update(tableSessions).set({
        pickupAt: body.pickupAt === null ? null : sql`${body.pickupAt}`,
        pickupPhone: body.pickupPhone as string | null,
        pickupCustomerId: customer?.customerId ?? null,
        pickupName: customer?.name ?? null,
      }).where(eq(tableSessions.sessionId, sessionId));
      return {
        sessionId,
        pickupAt: body.pickupAt as string | null,
        pickupPhone: body.pickupPhone as string | null,
        pickupCustomerId: customer?.customerId ?? null,
        pickupCustomerName: customer?.name ?? null,
      };
    });
    if (!updated) return Response.json({ success: false, message: "활성 포장 주문을 찾을 수 없습니다." }, { status: 409 });
    return Response.json({ success: true, session: updated });
  } catch (error) {
    console.error("Takeout update failed", error);
    return Response.json({ success: false, message: error instanceof Error && error.message === "선택한 고객을 찾을 수 없습니다." ? error.message : "포장 정보를 저장하지 못했습니다." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const staff = await actor();
  if (!staff && await getPosLoginMode() !== "SHARED")
    return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { sessionId?: unknown };
  const sessionId = Number(body.sessionId);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0)
    return Response.json({ success: false, message: "포장 주문을 확인해 주세요." }, { status: 400 });
  try {
    await db.transaction(async tx => {
      const [session] = await tx.select({ kind: tableSessions.sessionKind }).from(tableSessions)
        .where(and(eq(tableSessions.sessionId, sessionId), eq(tableSessions.status, "OPEN"))).for("update").limit(1);
      if (!session || session.kind === "DINE_IN") throw new Error("포장 주문이 이미 종료되었거나 없습니다.");
      const allocatedPayments = await tx.select({ paymentId: paymentSessionAllocations.paymentId, status: payments.status, appliedAmount: paymentSessionAllocations.appliedAmount }).from(paymentSessionAllocations)
        .innerJoin(payments, eq(paymentSessionAllocations.paymentId, payments.paymentId))
        .where(eq(paymentSessionAllocations.sessionId, sessionId)).for("update");
      const orderRows = await tx.select({ orderId: orders.orderId, status: orders.status }).from(orders).where(eq(orders.sessionId, sessionId)).for("update");
      const linkedPayments = orderRows.length ? await tx.select({ paymentId: payments.paymentId, status: payments.status, appliedAmount: payments.appliedAmount }).from(payments)
        .innerJoin(checkoutItems, eq(checkoutItems.checkoutId, payments.checkoutId))
        .innerJoin(orderItems, eq(orderItems.orderItemId, checkoutItems.orderItemId))
        .innerJoin(orders, eq(orders.orderId, orderItems.orderId))
        .where(and(eq(orders.sessionId, sessionId),
          sql`NOT EXISTS (SELECT 1 FROM payment_session_allocations AS existing_allocation WHERE existing_allocation.payment_id = ${payments.paymentId})`)).for("update") : [];
      const relevantPayments = [...allocatedPayments, ...linkedPayments];
      const paymentIds = [...new Set(relevantPayments.map(row => row.paymentId))];
      const ledgerRows = paymentIds.length ? await tx.select({ paymentId: customerPrepaidLedger.paymentId, amount: customerPrepaidLedger.amount })
        .from(customerPrepaidLedger).where(inArray(customerPrepaidLedger.paymentId, paymentIds)).for("update") : [];
      const hasEffectivePayment = hasOutstandingTakeoutPayment(allocatedPayments, linkedPayments, ledgerRows);
      if (hasEffectivePayment) throw new Error("이 포장에는 취소할 유효 결제 또는 고객 잔액이 남아 있습니다. 결제창에서 해당 결제를 취소한 뒤 포장을 취소해 주세요.");
      const orderIds = orderRows.map(order => order.orderId);
      const itemRows = orderIds.length ? await tx.select({ orderItemId: orderItems.orderItemId, orderId: orderItems.orderId, menuId: orderItems.menuId, qty: orderItems.qty, actualComponentQty: orderItems.actualComponentQty, unitPrice: orderItems.unitPrice, itemType: orderItems.itemType, status: orderItems.status }).from(orderItems).where(inArray(orderItems.orderId, orderIds)).for("update") : [];
      const itemIds = itemRows.map(item => item.orderItemId);
      const priorCancellations = itemIds.length ? await tx.select({ orderItemId: orderItemCancellations.orderItemId, qty: orderItemCancellations.cancelledQty }).from(orderItemCancellations).where(inArray(orderItemCancellations.orderItemId, itemIds)) : [];
      const cancelledQtyByItem = new Map<number, number>();
      priorCancellations.forEach(row => cancelledQtyByItem.set(row.orderItemId, (cancelledQtyByItem.get(row.orderItemId) ?? 0) + row.qty));

      const [sharedStaff] = !staff ? await tx.select({ staffId: staffTable.staffId }).from(staffTable).where(and(eq(staffTable.staffCode, "000"), eq(staffTable.isActive, 1))).limit(1) : [];
      const cancelledByStaffId = staff?.staffId ?? sharedStaff?.staffId;
      if (!cancelledByStaffId) throw new Error("포장 취소 처리 직원을 확인할 수 없습니다.");
      for (const item of itemRows) {
        const quantity = item.actualComponentQty ?? item.qty;
        const remaining = Math.max(0, quantity - (cancelledQtyByItem.get(item.orderItemId) ?? 0));
        if (!remaining) continue;
        const amount = item.itemType === "SERVICE" ? 0 : Math.round(Number(item.unitPrice) * 100) * remaining;
        await tx.insert(orderItemCancellations).values({ orderItemId: item.orderItemId, cancelledQty: remaining, cancelledAmount: (amount / 100).toFixed(2), cancellationReason: "포장 주문 취소", cancelledByStaffId });
        await tx.update(orderItems).set({ status: "CANCELLED", cancelledAt: new Date(), cancelledByStaffId }).where(eq(orderItems.orderItemId, item.orderItemId));
        await syncRiceOrderItemStock(tx, item.orderItemId, item.menuId, 0, cancelledByStaffId);
      }
      if (orderIds.length) await tx.update(orders).set({ subtotalAmount: "0.00", totalAmount: "0.00", status: "CANCELLED" }).where(inArray(orders.orderId, orderIds));
      await tx.update(tableSessions).set({ status: "CANCELLED", closedAt: sql`CURRENT_TIMESTAMP`, closedByStaffId: cancelledByStaffId }).where(eq(tableSessions.sessionId, sessionId));
    });
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "포장 주문을 취소하지 못했습니다." }, { status: 409 });
  }
}
