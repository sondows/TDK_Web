import type { RowDataPacket } from "mysql2";
import { pool } from "@/db";
import { getCurrentAdminStaff } from "@/lib/admin-auth";

type PaymentRow = RowDataPacket & {
  payment_method_id: number;
  customer_id: number | null;
  method_code: string;
  method_name: string;
  method_type: string;
  amount: string;
  applied_amount: string;
  note: string | null;
  status: string;
};
type MethodRow = RowDataPacket & { payment_method_id: number; method_code: string; method_name: string; method_type: string; is_active: number };
type DetailRow = RowDataPacket & { input_type_snapshot: string; quantity: number | null; submitted_amount: string; applied_amount: string; cash_change_amount: string; forfeited_amount: string };
class CorrectionError extends Error { constructor(message: string, public statusCode: number) { super(message); } }

export async function PATCH(request: Request, context: { params: Promise<{ checkoutId: string; paymentId: string }> }) {
  const admin = await getCurrentAdminStaff();
  if (!admin) return Response.json({ success: false, message: "관리자 권한이 필요합니다." }, { status: 403 });
  const { checkoutId: checkoutParam, paymentId: paymentParam } = await context.params;
  const checkoutId = Number(checkoutParam);
  const paymentId = Number(paymentParam);
  let body: { paymentMethodId?: unknown; customerId?: unknown };
  try { body = await request.json(); } catch { return Response.json({ success: false, message: "요청을 확인해 주세요." }, { status: 400 }); }
  const paymentMethodId = body?.paymentMethodId;
  const customerId = body?.customerId;
  if (![checkoutId, paymentId, paymentMethodId].every(value => Number.isSafeInteger(value) && Number(value) > 0)
    || (customerId !== undefined && (!Number.isSafeInteger(customerId) || Number(customerId) <= 0)))
    return Response.json({ success: false, message: "결제 및 결제수단을 확인해 주세요." }, { status: 400 });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [checkout] = await connection.query<RowDataPacket[]>("SELECT status FROM checkouts WHERE checkout_id = ? FOR UPDATE", [checkoutId]);
    if (!checkout.length) throw new CorrectionError("판매내역을 찾을 수 없습니다.", 404);
    if (checkout[0].status !== "PAID") throw new CorrectionError("결제완료된 판매만 정정할 수 있습니다.", 409);
    const [currentRows] = await connection.query<PaymentRow[]>(
      "SELECT p.payment_method_id, p.customer_id, p.amount, p.applied_amount, p.note, p.status, m.method_code, m.method_name, m.method_type FROM payments p JOIN payment_methods m ON m.payment_method_id = p.payment_method_id WHERE p.payment_id = ? AND p.checkout_id = ? FOR UPDATE",
      [paymentId, checkoutId]);
    const current = currentRows[0];
    if (!current) throw new CorrectionError("이 판매의 결제를 찾을 수 없습니다.", 404);
    if (current.status !== "APPROVED") throw new CorrectionError("완료된 정상 결제만 정정할 수 있습니다.", 409);
    const [targetRows] = await connection.query<MethodRow[]>(
      "SELECT payment_method_id, method_code, method_name, method_type, is_active FROM payment_methods WHERE payment_method_id = ? FOR UPDATE", [paymentMethodId]);
    const target = targetRows[0];
    if (!target || !target.is_active)
      throw new CorrectionError("사용 가능한 결제수단을 선택해 주세요.", 400);
    const isCustomerPayment = target.method_code === "CUSTOMER_PAYMENT";
    if (isCustomerPayment !== (customerId !== undefined))
      throw new CorrectionError("고객결제에는 고객을 지정하고, 다른 결제수단에는 고객을 지정하지 마세요.", 400);
    let targetCustomer: { customer_id: number; name: string | null; phone: string | null } | undefined;
    if (isCustomerPayment) {
      const [customerRows] = await connection.query<RowDataPacket[]>(
        "SELECT customer_id, name, phone FROM customers WHERE customer_id = ? AND is_active = 1 AND is_payment_managed = 1 FOR UPDATE", [customerId]);
      targetCustomer = customerRows[0] as typeof targetCustomer;
      if (!targetCustomer) throw new CorrectionError("사용 가능한 고객을 선택해 주세요.", 400);
    }
    if (Number(current.payment_method_id) === paymentMethodId && (!isCustomerPayment || Number(current.customer_id) === Number(customerId))) {
      await connection.commit();
      return Response.json({ success: true, unchanged: true });
    }
    const [ledgerRows] = await connection.query<RowDataPacket[]>("SELECT ledger_id FROM customer_prepaid_ledger WHERE payment_id = ? LIMIT 1 FOR UPDATE", [paymentId]);
    const [detailRows] = await connection.query<DetailRow[]>(
      "SELECT input_type_snapshot, quantity, submitted_amount, applied_amount, cash_change_amount, forfeited_amount FROM payment_other_details WHERE payment_id = ? FOR UPDATE", [paymentId]);
    const otherDetail = detailRows[0];
    if (current.method_code === "CUSTOMER_PAYMENT" || ledgerRows.length || Number(current.amount) !== Number(current.applied_amount)
      || (otherDetail && (otherDetail.input_type_snapshot !== "AMOUNT" || otherDetail.quantity !== null
        || Number(otherDetail.submitted_amount) !== Number(otherDetail.applied_amount)
        || Number(otherDetail.cash_change_amount) !== 0 || Number(otherDetail.forfeited_amount) !== 0)))
      throw new CorrectionError("고객 거래, 쿠폰 수량 또는 거스름 기록이 연결된 결제는 이 화면에서 정정할 수 없습니다.", 409);

    await connection.query("UPDATE payments SET payment_method_id = ?, customer_id = ? WHERE payment_id = ? AND checkout_id = ?",
      [paymentMethodId, targetCustomer?.customer_id ?? current.customer_id, paymentId, checkoutId]);
    if (otherDetail) {
      if (target.method_type === "CASH" || target.method_type === "CARD")
        await connection.query("DELETE FROM payment_other_details WHERE payment_id = ?", [paymentId]);
      else
        await connection.query("UPDATE payment_other_details SET method_name_snapshot = ? WHERE payment_id = ?", [target.method_name, paymentId]);
    }
    await connection.query(
      "INSERT INTO audit_logs (staff_id, action_type, entity_type, entity_id, description) VALUES (?, ?, ?, ?, ?)",
      [admin.staffId, "CORRECT_PAYMENT_METHOD", "PAYMENT", paymentId, JSON.stringify({ checkoutId, paymentId,
        before: { paymentMethodId: current.payment_method_id, code: current.method_code, name: current.method_name, customerId: current.customer_id },
        after: { paymentMethodId, code: target.method_code, name: target.method_name,
          customerId: targetCustomer?.customer_id ?? current.customer_id, customerName: targetCustomer?.name ?? null } })]);
    await connection.commit();
    return Response.json({ success: true });
  } catch (error) {
    await connection.rollback();
    if (error instanceof CorrectionError) return Response.json({ success: false, message: error.message }, { status: error.statusCode });
    console.error("admin payment method correction failed", error);
    return Response.json({ success: false, message: "결제수단을 변경하지 못했습니다." }, { status: 500 });
  } finally { connection.release(); }
}
