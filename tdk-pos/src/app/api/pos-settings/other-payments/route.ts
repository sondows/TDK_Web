import { randomBytes } from "crypto";
import { and, asc, eq, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, paymentMethods, paymentMethodSettings } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";

function canEdit(staff: Awaited<ReturnType<typeof getCurrentAdminStaff>>) {
  return Boolean(staff);
}

const validDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export async function GET(request: Request) {
  const pos = new URL(request.url).searchParams.get("pos") === "1";
  if (pos) {
    if (!await getCurrentStaff() && await getPosLoginMode() !== "SHARED") return Response.json({ success: false }, { status: 401 });
  } else if (!canEdit(await getCurrentAdminStaff())) {
    return Response.json({ success: false }, { status: 403 });
  }
  try {
    const rows = await db.select({
      id: paymentMethods.paymentMethodId,
      name: paymentMethods.methodName,
      isActive: paymentMethods.isActive,
      sortOrder: paymentMethods.sortOrder,
      inputType: paymentMethodSettings.inputType,
      unitAmount: paymentMethodSettings.unitAmount,
      balancePolicy: paymentMethodSettings.balancePolicy,
      cashChangeEnabled: paymentMethodSettings.cashChangeEnabled,
      cashChangeMinPercent: paymentMethodSettings.cashChangeMinPercent,
      validityEnabled: paymentMethodSettings.validityEnabled,
      validFrom: paymentMethodSettings.validFrom,
      validUntil: paymentMethodSettings.validUntil,
    }).from(paymentMethods)
      .leftJoin(paymentMethodSettings, eq(paymentMethodSettings.paymentMethodId, paymentMethods.paymentMethodId))
      .where(pos ? and(
        eq(paymentMethods.isActive, 1),
        sql`${paymentMethodSettings.paymentMethodId} IS NOT NULL`,
        or(eq(paymentMethodSettings.validityEnabled, 0), and(
          sql`${paymentMethodSettings.validFrom} <= CURRENT_DATE()`,
          sql`${paymentMethodSettings.validUntil} >= CURRENT_DATE()`,
        )),
      ) : notInArray(paymentMethods.methodCode, ["CARD", "CASH", "CUSTOMER_PAYMENT"]))
      .orderBy(asc(paymentMethods.sortOrder), asc(paymentMethods.paymentMethodId));
    return Response.json({ success: true, methods: rows.map(row => ({ ...row, configured: row.inputType !== null, inputType: row.inputType ?? "AMOUNT" })) });
  } catch {
    return Response.json({ success: false, message: "기타결제 설정을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const staff = await getCurrentAdminStaff();
  if (!canEdit(staff)) return Response.json({ success: false, message: "OWNER만 결제 설정을 변경할 수 있습니다." }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = body.id == null ? null : Number(body.id);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const isActive = body.isActive === true;
    const inputType = body.inputType as "AMOUNT" | "QUANTITY";
    const unitAmount = Number(body.unitAmount);
    const balancePolicy = body.balancePolicy as "CASH_CHANGE" | "FORFEIT";
    const cashChangeEnabled = body.cashChangeEnabled === null && id !== null ? null : body.cashChangeEnabled === true;
    const cashChangeMinPercent = Number(body.cashChangeMinPercent);
    const validityEnabled = body.validityEnabled === true;
    const validFrom = validityEnabled ? body.validFrom : null;
    const validUntil = validityEnabled ? body.validUntil : null;
    if ((id !== null && (!Number.isSafeInteger(id) || id <= 0)) || !name || name.length > 100 ||
      (inputType !== "AMOUNT" && inputType !== "QUANTITY") ||
      (inputType === "QUANTITY" && (!Number.isSafeInteger(unitAmount) || unitAmount <= 0 || unitAmount > 999999999)) ||
      (inputType === "QUANTITY" && balancePolicy !== "CASH_CHANGE" && balancePolicy !== "FORFEIT") ||
      (body.cashChangeEnabled !== true && body.cashChangeEnabled !== false && !(body.cashChangeEnabled === null && id !== null)) ||
      (cashChangeEnabled === true && (typeof body.cashChangeMinPercent !== "number" || !Number.isInteger(cashChangeMinPercent) || cashChangeMinPercent < 0 || cashChangeMinPercent > 100)) ||
      (validityEnabled && (!validDate(validFrom) || !validDate(validUntil) || validFrom > validUntil))) {
      return Response.json({ success: false, message: "설정 값을 확인해 주세요." }, { status: 400 });
    }
    const updated = await db.transaction(async tx => {
      let methodId = id;
      let sortOrder: number;
      if (methodId !== null) {
        const [existing] = await tx.select({ id: paymentMethods.paymentMethodId, code: paymentMethods.methodCode, sortOrder: paymentMethods.sortOrder, configured: paymentMethodSettings.paymentMethodId })
          .from(paymentMethods)
          .leftJoin(paymentMethodSettings, eq(paymentMethods.paymentMethodId, paymentMethodSettings.paymentMethodId))
          .where(eq(paymentMethods.paymentMethodId, methodId)).for("update").limit(1);
        if (!existing || existing.code === "CARD" || existing.code === "CASH" || existing.code === "CUSTOMER_PAYMENT") return null;
        sortOrder = existing.sortOrder;
        await tx.update(paymentMethods).set({ methodName: name, isActive: isActive ? 1 : 0 }).where(eq(paymentMethods.paymentMethodId, methodId));
        const settings = {
          inputType,
          unitAmount: inputType === "QUANTITY" ? unitAmount.toFixed(2) : null,
          balancePolicy: inputType === "QUANTITY" ? balancePolicy : null,
          cashChangeEnabled: cashChangeEnabled === null ? null : cashChangeEnabled ? 1 : 0,
          cashChangeMinPercent: cashChangeEnabled === true ? cashChangeMinPercent : null,
          validityEnabled: validityEnabled ? 1 : 0,
          validFrom: validityEnabled ? validFrom as string : null,
          validUntil: validityEnabled ? validUntil as string : null,
          updatedByStaffId: staff!.staffId,
        };
        if (existing.configured) await tx.update(paymentMethodSettings).set(settings).where(eq(paymentMethodSettings.paymentMethodId, methodId));
        else await tx.insert(paymentMethodSettings).values({ paymentMethodId: methodId, ...settings });
      } else {
        const orders = await tx.select({ sortOrder: paymentMethods.sortOrder })
          .from(paymentMethods).where(notInArray(paymentMethods.methodCode, ["CARD", "CASH", "CUSTOMER_PAYMENT"])).for("update");
        sortOrder = Math.max(0, ...orders.map(row => row.sortOrder)) + 1;
        if (sortOrder > 9999) throw new Error("결제수단 표시순서 한도를 초과했습니다.");
        const code = `OTHER_${randomBytes(12).toString("hex").toUpperCase()}`;
        const [created] = await tx.insert(paymentMethods).values({ methodCode: code, methodName: name, methodType: "OTHER", isActive: isActive ? 1 : 0, sortOrder }).$returningId();
        methodId = created.paymentMethodId;
        await tx.insert(paymentMethodSettings).values({
          paymentMethodId: methodId,
          inputType,
          unitAmount: inputType === "QUANTITY" ? unitAmount.toFixed(2) : null,
          balancePolicy: inputType === "QUANTITY" ? balancePolicy : null,
          cashChangeEnabled: cashChangeEnabled ? 1 : 0,
          cashChangeMinPercent: cashChangeEnabled === true ? cashChangeMinPercent : null,
          validityEnabled: validityEnabled ? 1 : 0,
          validFrom: validityEnabled ? validFrom as string : null,
          validUntil: validityEnabled ? validUntil as string : null,
          updatedByStaffId: staff!.staffId,
        });
      }
      await tx.insert(auditLogs).values({
        staffId: staff!.staffId, actionType: id === null ? "CREATE" : "UPDATE",
        entityType: "PAYMENT_METHOD", entityId: methodId,
        description: JSON.stringify({ name, isActive, sortOrder, inputType, unitAmount: inputType === "QUANTITY" ? unitAmount : null, balancePolicy: inputType === "QUANTITY" ? balancePolicy : null, cashChangeEnabled, cashChangeMinPercent: cashChangeEnabled === true ? cashChangeMinPercent : null, validFrom, validUntil }),
      });
      return methodId;
    });
    if (updated === null) return Response.json({ success: false, message: "수정할 결제수단을 찾지 못했습니다." }, { status: 404 });
    return Response.json({ success: true, id: updated });
  } catch {
    return Response.json({ success: false, message: "결제 설정을 저장하지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const staff = await getCurrentAdminStaff();
  if (!canEdit(staff)) return Response.json({ success: false, message: "OWNER만 결제 설정을 변경할 수 있습니다." }, { status: 403 });
  try {
    const body = await request.json() as { ids?: unknown };
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 9999 ||
      ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
      return Response.json({ success: false, message: "결제수단 순서를 확인해 주세요." }, { status: 400 });
    }
    const saved = await db.transaction(async tx => {
      const rows = await tx.select({ id: paymentMethods.paymentMethodId })
        .from(paymentMethods)
        .where(notInArray(paymentMethods.methodCode, ["CARD", "CASH", "CUSTOMER_PAYMENT"]))
        .orderBy(asc(paymentMethods.paymentMethodId))
        .for("update");
      const actualIds = new Set(rows.map(row => row.id));
      if (actualIds.size !== ids.length || ids.some(id => !actualIds.has(id))) return false;
      for (const [index, id] of ids.entries()) {
        await tx.update(paymentMethods).set({ sortOrder: index + 1 }).where(eq(paymentMethods.paymentMethodId, id));
      }
      await tx.insert(auditLogs).values({
        staffId: staff!.staffId,
        actionType: "REORDER",
        entityType: "PAYMENT_METHOD",
        description: JSON.stringify({ ids }),
      });
      return true;
    });
    if (!saved) return Response.json({ success: false, message: "결제수단 목록이 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    return Response.json({ success: true });
  } catch {
    return Response.json({ success: false, message: "순서를 저장하지 못했습니다." }, { status: 500 });
  }
}
