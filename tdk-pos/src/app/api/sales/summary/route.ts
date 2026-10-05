import { and, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { checkoutItems, checkouts, orderItems, orders, paymentMethods, payments, tableSessionMerges, tableSessions } from "@/db/schema";
import { getCurrentStaff, verifyActiveStaffCredentials } from "@/lib/auth";
import { canViewSales } from "@/lib/permissions";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { isValidPin } from "@/lib/pin";
import { loadCurrentPendingSales } from "@/lib/current-pending-sales";

export const dynamic = "force-dynamic";

function dateRange(startDate: string, endDate: string) {
  const valid = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!valid(startDate) || !valid(endDate) || startDate > endDate) return null;
  const end = new Date(`${endDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: `${startDate} 00:00:00`, end: `${end.toISOString().slice(0, 10)} 00:00:00` };
}

const won = (value: string | number) => Math.max(0, Math.floor(Number(value)));

function todayInSeoul() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export async function POST(request: Request) {
  try {
    const [currentStaff, loginMode] = await Promise.all([getCurrentStaff(), getPosLoginMode()]);
    if (!currentStaff && loginMode !== "SHARED")
      return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
    const body = await request.json() as Record<string, unknown>;
    const staffCode = typeof body.staffCode === "string" ? body.staffCode.trim() : "";
    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!staffCode || staffCode === "000" || !isValidPin(pin))
      return Response.json({ success: false, message: "개인 직원 계정과 PIN을 확인해 주세요." }, { status: 401 });
    const employee = await verifyActiveStaffCredentials(staffCode, pin);
    if (!employee) return Response.json({ success: false, message: "직원 또는 PIN이 올바르지 않습니다." }, { status: 401 });
    if (!canViewSales(employee.role))
      return Response.json({ success: false, message: "매출현황 조회 권한이 없습니다." }, { status: 403 });
    const startDate = typeof body.startDate === "string" ? body.startDate : "";
    const endDate = typeof body.endDate === "string" ? body.endDate : "";
    const range = dateRange(startDate, endDate);
    if (!range) return Response.json({ success: false, message: "조회기간을 확인해 주세요." }, { status: 400 });

    // Current open bills are exact; deleted records and changed grouping make
    // historical open bills impossible to reconstruct from the existing schema.
    const pending = startDate === endDate && startDate === todayInSeoul()
      ? await loadCurrentPendingSales() : null;
    const pendingFields = (grossSales: number, transactionCount: number) => ({
      pendingAmount: pending?.amount ?? null,
      pendingCount: pending?.count ?? null,
      salesIncludingPending: pending === null ? null : grossSales + pending.amount,
      countIncludingPending: pending === null ? null : transactionCount + pending.count,
    });

    const checkoutRows = await db.select({ id: checkouts.checkoutId, total: checkouts.totalAmount, discount: checkouts.discountAmount, status: checkouts.status })
      .from(checkouts)
      .where(sql`${checkouts.completedAt} >= ${range.start} AND ${checkouts.completedAt} < ${range.end}`);
    const ids = checkoutRows.map(row => row.id);
    if (!ids.length) return Response.json({ success: true, summary: {
      grossSales: 0, netSales: 0, transactionCount: 0, cancellationCount: 0, ...pendingFields(0, 0),
      discountAmount: 0, discountCount: 0, cancelledAmount: 0,
      cardAmount: 0, cardCount: 0, cashAmount: 0, cashCount: 0, otherAmount: 0, otherCount: 0,
      tableCount: 0, knownGuestCount: 0,
      tableAverage: null, guestAverage: null, guestCount: 0, tableGuestAverage: null,
      durationMinutes: null, incompleteGuestCount: 0,
    } }, { headers: { "Cache-Control": "no-store" } });

    const [paymentRows, sessionRows] = await Promise.all([
      db.select({ checkoutId: payments.checkoutId, appliedAmount: payments.appliedAmount, methodType: paymentMethods.methodType, status: payments.status,
        cancelledAt: sql<string | null>`DATE_FORMAT(${payments.cancelledAt}, '%Y-%m-%d')` })
        .from(payments).innerJoin(paymentMethods, eq(payments.paymentMethodId, paymentMethods.paymentMethodId)).where(inArray(payments.checkoutId, ids)),
      db.selectDistinct({ checkoutId: checkoutItems.checkoutId, sessionId: tableSessions.sessionId, groupId: tableSessions.groupId,
        adults: tableSessions.personCount, children: tableSessions.babyCount,
        openedAt: tableSessions.openedAt, closedAt: tableSessions.closedAt })
        .from(checkoutItems)
        .innerJoin(orderItems, eq(checkoutItems.orderItemId, orderItems.orderItemId))
        .innerJoin(orders, eq(orderItems.orderId, orders.orderId))
        .innerJoin(tableSessions, eq(orders.sessionId, tableSessions.sessionId))
        .where(inArray(checkoutItems.checkoutId, ids)),
    ]);
    const paymentsByCheckout = new Map<number, typeof paymentRows>();
    for (const payment of paymentRows)
      paymentsByCheckout.set(payment.checkoutId, [...(paymentsByCheckout.get(payment.checkoutId) ?? []), payment]);
    const sessionsByCheckout = new Map<number, typeof sessionRows>();
    for (const session of sessionRows)
      sessionsByCheckout.set(session.checkoutId, [...(sessionsByCheckout.get(session.checkoutId) ?? []), session]);
    // Include party tables with no ordered item of their own and merged source
    // tables. Their guests and occupied time still belong to the same meal.
    const linkedIds = [...new Set(sessionRows.map(row => row.sessionId))];
    const groupIds = [...new Set(sessionRows.map(row => row.groupId).filter((id): id is number => id !== null))];
    const [groupSessions, mergeRows] = await Promise.all([
      groupIds.length ? db.select({ sessionId: tableSessions.sessionId, groupId: tableSessions.groupId,
        adults: tableSessions.personCount, children: tableSessions.babyCount,
        openedAt: tableSessions.openedAt, closedAt: tableSessions.closedAt })
        .from(tableSessions).where(inArray(tableSessions.groupId, groupIds)) : [],
      linkedIds.length ? db.select({ sourceId: tableSessionMerges.sourceSessionId,
        destinationId: tableSessionMerges.destinationSessionId })
        .from(tableSessionMerges)
        .where(and(eq(tableSessionMerges.status, "ACTIVE"), or(
          inArray(tableSessionMerges.sourceSessionId, linkedIds),
          inArray(tableSessionMerges.destinationSessionId, linkedIds),
        ))) : [],
    ]);
    const mergedIds = [...new Set(mergeRows.flatMap(row => [row.sourceId, row.destinationId]))];
    const mergedSessions = mergedIds.length ? await db.select({ sessionId: tableSessions.sessionId,
      groupId: tableSessions.groupId, adults: tableSessions.personCount, children: tableSessions.babyCount,
      openedAt: tableSessions.openedAt, closedAt: tableSessions.closedAt })
      .from(tableSessions).where(inArray(tableSessions.sessionId, mergedIds)) : [];
    const sessionById = new Map([...groupSessions, ...mergedSessions, ...sessionRows].map(row => [row.sessionId, row]));
    for (const [checkoutId, rows] of sessionsByCheckout) {
      const idsForCheckout = new Set(rows.map(row => row.sessionId));
      for (const row of rows) if (row.groupId !== null)
        for (const member of groupSessions) if (member.groupId === row.groupId) idsForCheckout.add(member.sessionId);
      for (const merge of mergeRows) if (idsForCheckout.has(merge.sourceId) || idsForCheckout.has(merge.destinationId)) {
        idsForCheckout.add(merge.sourceId); idsForCheckout.add(merge.destinationId);
      }
      sessionsByCheckout.set(checkoutId, [...idsForCheckout].map(id => ({ ...sessionById.get(id)!, checkoutId })));
    }

    let grossSales = 0, netSales = 0, transactionCount = 0, cancellationCount = 0;
    let discountAmount = 0, discountCount = 0, cancelledAmount = 0;
    let cardAmount = 0, cardCount = 0, cashAmount = 0, cashCount = 0, otherAmount = 0, otherCount = 0;
    let guestCount = 0, incompleteGuestCount = 0, durationTotal = 0, durationCount = 0;
    for (const checkout of checkoutRows) {
      const discount = won(checkout.discount);
      discountAmount += discount;
      if (discount > 0) discountCount++;
    }
    for (const payment of paymentRows) {
      const amount = won(payment.appliedAmount);
      if ((payment.status === "CANCELLED" || payment.status === "REFUNDED") && payment.cancelledAt && payment.cancelledAt >= startDate && payment.cancelledAt <= endDate) {
        cancelledAmount += amount;
        cancellationCount++;
      }
      if (payment.status !== "APPROVED") continue;
      netSales += amount;
      if (payment.methodType === "CARD") { cardAmount += amount; cardCount++; }
      else if (payment.methodType === "CASH") { cashAmount += amount; cashCount++; }
      else { otherAmount += amount; otherCount++; }
    }
    for (const checkout of checkoutRows) {
      const relatedPayments = paymentsByCheckout.get(checkout.id) ?? [];
      const approved = relatedPayments.filter(row => row.status === "APPROVED").reduce((sum, row) => sum + won(row.appliedAmount), 0);
      const relatedSessions = sessionsByCheckout.get(checkout.id) ?? [];
      // A merged group paid with one checkout is one completed meal transaction.
      grossSales += won(checkout.total);
      if (approved <= 0) continue;
      transactionCount++;
      const people = relatedSessions.reduce((sum, row) => sum + row.adults + row.children, 0);
      if (!relatedSessions.length || people <= 0) incompleteGuestCount++;
      else guestCount += people;
      if (relatedSessions.length && relatedSessions.every(row => row.closedAt)) {
        const first = Math.min(...relatedSessions.map(row => row.openedAt.getTime()));
        const last = Math.max(...relatedSessions.map(row => row.closedAt!.getTime()));
        if (last >= first) { durationTotal += (last - first) / 60_000; durationCount++; }
      }
    }
    const effectiveCount = transactionCount;
    return Response.json({ success: true, summary: {
      grossSales, netSales, transactionCount, cancellationCount, discountAmount, discountCount, cancelledAmount,
      ...pendingFields(grossSales, transactionCount),
      cardAmount, cardCount, cashAmount, cashCount, otherAmount, otherCount,
      tableCount: effectiveCount, knownGuestCount: guestCount,
      tableAverage: effectiveCount ? Math.round(netSales / effectiveCount) : null,
      guestAverage: guestCount && !incompleteGuestCount ? Math.round(netSales / guestCount) : null,
      guestCount: incompleteGuestCount ? null : guestCount,
      tableGuestAverage: effectiveCount && !incompleteGuestCount ? Math.round(guestCount / effectiveCount * 10) / 10 : null,
      durationMinutes: durationCount === effectiveCount && effectiveCount ? Math.round(durationTotal / durationCount) : null,
      incompleteGuestCount,
    } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("sales summary failed", error);
    return Response.json({ success: false, message: "매출현황을 불러오지 못했습니다." }, { status: 500 });
  }
}
