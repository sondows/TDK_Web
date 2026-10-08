import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { discountRules, orderItemCancellations, orderItems, orders, staff, tableSessionDiscounts, tableSessionMerges, tableSessions } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { presetSnapshotLabel } from "@/lib/discount-label";
import { getPosLoginMode } from "@/lib/pos-login-mode";

type DiscountType = "AMOUNT" | "PERCENT";
type RequestedDiscount = { type?: unknown; amount?: unknown; rate?: unknown; presetId?: unknown };
const asWholeWon = (value: unknown) => Number.isSafeInteger(Number(value)) ? Number(value) : NaN;

async function posAuth() {
  const currentStaff = await getCurrentStaff();
  const sharedMode = await getPosLoginMode() === "SHARED";
  return { currentStaff, sharedMode, allowed: Boolean(currentStaff || sharedMode) };
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const auth = await posAuth();
  if (!auth.allowed) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  const sessionId = Number((await params).sessionId);
  if (!Number.isInteger(sessionId) || sessionId <= 0) return Response.json({ success: false, message: "세션이 올바르지 않습니다." }, { status: 400 });
  try {
    const sessionIds = await db.transaction(async tx => {
      const [target] = await tx.select({ sessionId: tableSessions.sessionId }).from(tableSessions).where(and(eq(tableSessions.sessionId, sessionId), eq(tableSessions.status, "OPEN"))).limit(1);
      if (!target) throw new DiscountError("사용 중인 테이블을 찾을 수 없습니다.", 404);
      const merges = await tx.select({ sourceSessionId: tableSessionMerges.sourceSessionId }).from(tableSessionMerges).where(and(eq(tableSessionMerges.destinationSessionId, sessionId), eq(tableSessionMerges.status, "ACTIVE")));
      const physicalSessionIds = [...new Set([sessionId, ...merges.map(merge => merge.sourceSessionId)])];
      await tx.delete(tableSessionDiscounts).where(inArray(tableSessionDiscounts.sessionId, physicalSessionIds));
      return physicalSessionIds;
    });
    return Response.json({ success: true, sessionIds });
  } catch (error) {
    if (error instanceof DiscountError) return Response.json({ success: false, message: error.message }, { status: error.status });
    return Response.json({ success: false, message: "할인 초기화에 실패했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const auth = await posAuth();
  if (!auth.allowed) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  const sessionId = Number((await params).sessionId);
  let body: { discounts?: RequestedDiscount[] };
  try { body = await request.json() as { discounts?: RequestedDiscount[] }; } catch { return Response.json({ success: false, message: "할인 요청을 확인하세요." }, { status: 400 }); }
  if (!Number.isInteger(sessionId) || sessionId <= 0 || !Array.isArray(body.discounts) || body.discounts.length === 0 || body.discounts.length > 10) return Response.json({ success: false, message: "할인 요청을 확인하세요." }, { status: 400 });
  const requestedDiscounts = body.discounts;
  try {
    const inserted = await db.transaction(async tx => {
      const [target] = await tx.select({ sessionId: tableSessions.sessionId }).from(tableSessions).where(and(eq(tableSessions.sessionId, sessionId), eq(tableSessions.status, "OPEN"))).limit(1);
      if (!target) throw new DiscountError("사용 중인 테이블을 찾을 수 없습니다.", 404);
      const merges = await tx.select({ sourceSessionId: tableSessionMerges.sourceSessionId }).from(tableSessionMerges).where(and(eq(tableSessionMerges.destinationSessionId, sessionId), eq(tableSessionMerges.status, "ACTIVE")));
      const physicalSessionIds = [...new Set([sessionId, ...merges.map(merge => merge.sourceSessionId)])];
      const sessionOrders = await tx.select({ orderId: orders.orderId }).from(orders).where(inArray(orders.sessionId, physicalSessionIds));
      const orderIds = sessionOrders.map(order => order.orderId);
      const rows = orderIds.length ? await tx.select({ orderItemId: orderItems.orderItemId, qty: orderItems.qty, unitPrice: orderItems.unitPrice, itemType: orderItems.itemType }).from(orderItems).where(inArray(orderItems.orderId, orderIds)) : [];
      const itemIds = rows.map(item => item.orderItemId);
      const cancellations = itemIds.length ? await tx.select({ orderItemId: orderItemCancellations.orderItemId, cancelledQty: orderItemCancellations.cancelledQty }).from(orderItemCancellations).where(inArray(orderItemCancellations.orderItemId, itemIds)) : [];
      const cancelledByItem = new Map<number, number>();
      cancellations.forEach(cancellation => cancelledByItem.set(cancellation.orderItemId, (cancelledByItem.get(cancellation.orderItemId) ?? 0) + cancellation.cancelledQty));
      const subtotal = rows.reduce((sum, item) => sum + (item.itemType === "SERVICE" ? 0 : Math.max(0, item.qty - (cancelledByItem.get(item.orderItemId) ?? 0)) * Number(item.unitPrice)), 0);
      if (subtotal <= 0) throw new DiscountError("할인할 유효 주문금액이 없습니다.", 409);
      const presetIds = [...new Set(requestedDiscounts.flatMap(discount => { const presetId = asWholeWon(discount.presetId); return Number.isInteger(presetId) && presetId > 0 ? [presetId] : []; }))];
      const presets = presetIds.length ? await tx.select({ ruleId: discountRules.discountRuleId, slot: discountRules.posPresetSlot, title: discountRules.discountName, type: discountRules.discountType, value: discountRules.discountValue, isActive: discountRules.isActive }).from(discountRules).where(inArray(discountRules.discountRuleId, presetIds)) : [];
      const presetById = new Map(presets.filter(preset => preset.slot !== null && preset.slot >= 1 && preset.slot <= 4 && preset.isActive === 1 && (preset.type === "AMOUNT" || preset.type === "RATE")).map(preset => [preset.ruleId, preset]));
      if (presetIds.some(presetId => !presetById.has(presetId))) throw new DiscountError("지정 할인 설정이 변경되었습니다. 다시 선택해 주세요.", 409);
      const existing = await tx.select({ discountAmount: tableSessionDiscounts.discountAmount }).from(tableSessionDiscounts).where(inArray(tableSessionDiscounts.sessionId, physicalSessionIds));
      let remaining = Math.max(0, subtotal - existing.reduce((sum, discount) => sum + Number(discount.discountAmount), 0));
      const prepared: Array<{ discountType: DiscountType; label: string; discountAmount: string; discountRate: number | null }> = [];
      const selectedPresets = new Set<number>(); const directTypes = new Set<DiscountType>();
      for (const requested of requestedDiscounts) {
        const presetId = asWholeWon(requested.presetId);
        let type: DiscountType; let amount: number; let rate: number | null = null; let label: string;
        if (Number.isInteger(presetId) && presetId > 0) {
          if (selectedPresets.has(presetId)) throw new DiscountError("같은 지정 할인을 한 번만 선택할 수 있습니다.", 400);
          selectedPresets.add(presetId); const preset = presetById.get(presetId)!; type = preset.type === "RATE" ? "PERCENT" : "AMOUNT";
          const value = asWholeWon(preset.value);
          if (!Number.isInteger(value) || value <= 0 || (type === "PERCENT" && value > 100)) throw new DiscountError("지정 할인 설정을 확인하세요.", 409);
          rate = type === "PERCENT" ? value : null; amount = type === "PERCENT" ? Math.floor(remaining * value / 100) : value; label = presetSnapshotLabel(preset.title, type, value);
        } else {
          if (requested.type !== "AMOUNT" && requested.type !== "PERCENT") throw new DiscountError("할인 종류를 확인하세요.", 400);
          type = requested.type; if (directTypes.has(type)) throw new DiscountError("같은 직접 할인을 한 번만 선택할 수 있습니다.", 400); directTypes.add(type);
          if (type === "AMOUNT") { amount = asWholeWon(requested.amount); label = "금액 할인"; }
          else { rate = asWholeWon(requested.rate); if (!Number.isInteger(rate) || rate < 1 || rate > 100) throw new DiscountError("할인율은 1~100%로 입력하세요.", 400); amount = Math.floor(remaining * rate / 100); label = `비율 할인 ${rate}%`; }
        }
        if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) throw new DiscountError("할인금액은 현재 할인 가능한 주문금액을 초과할 수 없습니다.", 409);
        prepared.push({ discountType: type, label, discountAmount: amount.toFixed(2), discountRate: rate }); remaining -= amount;
      }
      let appliedByStaffId = auth.currentStaff?.staffId ?? null;
      if (!appliedByStaffId && auth.sharedMode) { const [sharedStaff] = await tx.select({ staffId: staff.staffId }).from(staff).where(and(eq(staff.staffCode, "000"), eq(staff.isActive, 1))).limit(1); appliedByStaffId = sharedStaff?.staffId ?? null; }
      await tx.insert(tableSessionDiscounts).values(prepared.map(discount => ({ sessionId, ...discount, appliedByStaffId }))); return prepared;
    });
    return Response.json({ success: true, discounts: inserted });
  } catch (error) {
    if (error instanceof DiscountError) return Response.json({ success: false, message: error.message }, { status: error.status });
    return Response.json({ success: false, message: "할인을 적용하지 못했습니다." }, { status: 500 });
  }
}

class DiscountError extends Error { constructor(message: string, readonly status: number) { super(message); } }
