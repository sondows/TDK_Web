import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { checkouts, customerPrepaidLedger, customers, paymentMethods, payments } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { adjustmentReasons, tradeMethods, type TradeEntryType } from "@/lib/customer-trade";

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

function customerIdFrom(value: string) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function transactionDateTime(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+09:00`);
  if (Number.isNaN(date.getTime())) return null;
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date).replace(" ", "T");
  return formatted === value ? value : null;
}

function parseDate(value: string | null) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00+09:00`);
  return !Number.isNaN(date.getTime()) && new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date) === value ? value : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ customerId: string }> }) {
  try {
    if (!await getCurrentAdminStaff()) return json({ success: false, message: "로그인이 필요합니다." }, 401);
    const customerId = customerIdFrom((await params).customerId);
    if (!customerId) return json({ success: false, message: "고객을 확인해 주세요." }, 400);
    const url = new URL(request.url);
    const startRaw = url.searchParams.get("startDate");
    const endRaw = url.searchParams.get("endDate");
    const startDate = parseDate(startRaw);
    const endDate = parseDate(endRaw);
    if ((startRaw && !startDate) || (endRaw && !endDate) || (startDate && endDate && startDate > endDate)) {
      return json({ success: false, message: "조회 기간을 확인해 주세요." }, 400);
    }
    const [customer] = await db.select({ customerId: customers.customerId }).from(customers)
      .where(eq(customers.customerId, customerId)).limit(1);
    if (!customer) return json({ success: false, message: "고객을 찾지 못했습니다." }, 404);

    // Calculate over the complete history first. A date filter must not reset the running balance.
    const rows = await db.select({
      ledgerId: customerPrepaidLedger.ledgerId,
      entryType: customerPrepaidLedger.entryType,
      amount: customerPrepaidLedger.amount,
      transactionAt: sql<string>`DATE_FORMAT(${customerPrepaidLedger.transactionAt}, '%Y-%m-%dT%H:%i:%s')`,
      createdAt: sql<string>`DATE_FORMAT(${customerPrepaidLedger.createdAt}, '%Y-%m-%dT%H:%i:%s')`,
      methodCode: customerPrepaidLedger.methodCode,
      adjustmentReason: customerPrepaidLedger.adjustmentReason,
      memo: customerPrepaidLedger.memo,
      paymentId: customerPrepaidLedger.paymentId,
      checkoutId: checkouts.checkoutId,
      paymentMethodName: paymentMethods.methodName,
      reversesLedgerId: customerPrepaidLedger.reversesLedgerId,
    }).from(customerPrepaidLedger)
      .leftJoin(payments, eq(payments.paymentId, customerPrepaidLedger.paymentId))
      .leftJoin(checkouts, eq(checkouts.checkoutId, payments.checkoutId))
      .leftJoin(paymentMethods, eq(paymentMethods.paymentMethodId, payments.paymentMethodId))
      .where(eq(customerPrepaidLedger.customerId, customerId))
      .orderBy(asc(customerPrepaidLedger.transactionAt), asc(customerPrepaidLedger.ledgerId));

    let balance = 0;
    const entries = rows.map(row => {
      const amount = Number(row.amount);
      balance += amount;
      return { ...row, entryType: row.entryType as TradeEntryType, amount, balance };
    }).filter(row => (!startDate || row.transactionAt.slice(0, 10) >= startDate)
      && (!endDate || row.transactionAt.slice(0, 10) <= endDate)).reverse();
    return json({ success: true, balance, entries });
  } catch (error) {
    console.error("Failed to load customer trade ledger", error);
    return json({ success: false, message: "거래내역을 불러오지 못했습니다." }, 500);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ customerId: string }> }) {
  try {
    const member = await getCurrentAdminStaff();
    if (!member) return json({ success: false, message: "로그인이 필요합니다." }, 401);
    const customerId = customerIdFrom((await params).customerId);
    if (!customerId) return json({ success: false, message: "고객을 확인해 주세요." }, 400);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("body");
      body = parsed as Record<string, unknown>;
    } catch { return json({ success: false, message: "거래 입력값을 확인해 주세요." }, 400); }
    const kind = body.kind;
    if (kind !== "DEPOSIT" && kind !== "REFUND" && kind !== "ADJUSTMENT") {
      return json({ success: false, message: "거래 유형을 확인해 주세요." }, 400);
    }
    const transactionAt = transactionDateTime(body.transactionAt);
    if (!transactionAt) return json({ success: false, message: "거래일시를 확인해 주세요." }, 400);
    const requestKey = body.requestKey;
    if (typeof requestKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) {
      return json({ success: false, message: "요청 식별값을 확인해 주세요." }, 400);
    }
    const memo = typeof body.memo === "string" ? body.memo.trim() : "";
    if (memo.length > 500) return json({ success: false, message: "메모는 500자 이내로 입력해 주세요." }, 400);
    const methodCode = body.methodCode;
    if (kind !== "ADJUSTMENT" && !tradeMethods.some(method => method.value === methodCode)) {
      return json({ success: false, message: "처리 방법을 선택해 주세요." }, 400);
    }
    const rawReason = body.reason;
    const customReason = typeof body.customReason === "string" ? body.customReason.trim() : "";
    if (kind === "ADJUSTMENT" && (!adjustmentReasons.some(reason => reason === rawReason) || (rawReason === "기타" && !customReason) || customReason.length > 100)) {
      return json({ success: false, message: "조정사유를 입력해 주세요." }, 400);
    }
    const value = kind === "ADJUSTMENT" ? body.targetBalance : body.amount;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || Math.abs(value) > 999999999999 || (kind !== "ADJUSTMENT" && value <= 0)) {
      return json({ success: false, message: "금액을 확인해 주세요." }, 400);
    }

    const result = await db.transaction(async tx => {
      const [customer] = await tx.select({ customerId: customers.customerId }).from(customers)
        .where(eq(customers.customerId, customerId)).for("update").limit(1);
      if (!customer) return { status: 404, message: "고객을 찾지 못했습니다." };
      const [existing] = await tx.select({ ledgerId: customerPrepaidLedger.ledgerId, customerId: customerPrepaidLedger.customerId })
        .from(customerPrepaidLedger).where(eq(customerPrepaidLedger.requestKey, requestKey)).limit(1);
      if (existing) return existing.customerId === customerId
        ? { status: 200, ledgerId: existing.ledgerId }
        : { status: 409, message: "이미 사용된 요청 식별값입니다." };

      const [balanceRow] = await tx.select({ balance: sql<string>`COALESCE(SUM(${customerPrepaidLedger.amount}), 0)` })
        .from(customerPrepaidLedger).where(eq(customerPrepaidLedger.customerId, customerId));
      const balance = Number(balanceRow.balance);
      const amount = kind === "DEPOSIT" ? value : kind === "REFUND" ? -value : value - balance;
      if (kind === "REFUND" && (balance <= 0 || value > balance)) return { status: 409, message: "현재 플러스 거래잔액을 초과하여 환불할 수 없습니다." };
      if (!amount) return { status: 400, message: "조정할 금액이 없습니다." };
      if (!Number.isSafeInteger(amount) || Math.abs(amount) > 999999999999) return { status: 400, message: "조정금액이 허용 범위를 초과합니다." };

      const [inserted] = await tx.insert(customerPrepaidLedger).values({
        customerId,
        paymentId: null,
        entryType: kind,
        amount: amount.toFixed(2),
        transactionAt: sql`STR_TO_DATE(${transactionAt}, '%Y-%m-%dT%H:%i')`,
        methodCode: kind === "ADJUSTMENT" ? null : methodCode as string,
        adjustmentReason: kind === "ADJUSTMENT" ? rawReason === "기타" ? customReason : rawReason as string : null,
        memo: memo || null,
        requestKey,
        createdByStaffId: member.staffId,
      }).$returningId();
      return { status: 201, ledgerId: inserted.ledgerId };
    });
    if ("message" in result) return json({ success: false, message: result.message }, result.status);
    return json({ success: true, ledgerId: result.ledgerId }, result.status);
  } catch (error) {
    console.error("Failed to post customer trade", error);
    return json({ success: false, message: "거래를 기록하지 못했습니다." }, 500);
  }
}
