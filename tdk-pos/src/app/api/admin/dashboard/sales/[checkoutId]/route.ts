import type { RowDataPacket } from "mysql2";
import { pool } from "@/db";
import { getCurrentAdminStaff, requireAdminAccess } from "@/lib/admin-auth";

class DeleteConflict extends Error {}
type IdRow = RowDataPacket & { id: number };
type PaymentRow = IdRow & { parentId: number | null };
type LedgerRow = IdRow & { customerId: number; entryType: string; amount: string; memo: string | null; parentId: number | null };

const reversalTypes: Record<string, string> = {
  CARD_OVERPAYMENT: "CARD_OVERPAYMENT_REVERSAL",
  PAYMENT_OVERPAYMENT: "PAYMENT_OVERPAYMENT_REVERSAL",
  CUSTOMER_PAYMENT: "CUSTOMER_PAYMENT_REVERSAL",
};

export async function DELETE(_request: Request, context: { params: Promise<{ checkoutId: string }> }) {
  const writeDenied = await requireAdminAccess(); if (writeDenied) return writeDenied;
  const admin = await getCurrentAdminStaff();
  if (!admin) return Response.json({ success: false, message: "OWNER 권한이 필요합니다." }, { status: 403 });
  const checkoutId = Number((await context.params).checkoutId);
  if (!Number.isSafeInteger(checkoutId) || checkoutId <= 0)
    return Response.json({ success: false, message: "판매내역을 확인해 주세요." }, { status: 400 });

  const connection = await pool.getConnection();
  let phase = "checkout 조회";
  try {
    await connection.beginTransaction();
    const [checkout] = await connection.query<RowDataPacket[]>(
      "SELECT checkout_id FROM checkouts WHERE checkout_id = ? FOR UPDATE", [checkoutId]);
    if (!checkout.length) throw new DeleteConflict("이미 삭제했거나 존재하지 않는 판매내역입니다.");

    phase = "판매 주문 범위 확인";
    const [orderRows] = await connection.query<IdRow[]>(
      "SELECT DISTINCT oi.order_id AS id FROM checkout_items ci JOIN order_items oi ON oi.order_item_id = ci.order_item_id WHERE ci.checkout_id = ?", [checkoutId]);
    const orderIds = orderRows.map(row => Number(row.id));
    if (!orderIds.length) throw new DeleteConflict("연결된 주문을 확인할 수 없어 삭제하지 않았습니다.");
    const [sessionRows] = await connection.query<IdRow[]>(
      "SELECT DISTINCT session_id AS id FROM orders WHERE order_id IN (?) FOR UPDATE", [orderIds]);
    const sessionIds = sessionRows.map(row => Number(row.id));
    const [itemRows] = await connection.query<IdRow[]>(
      "SELECT order_item_id AS id FROM order_items WHERE order_id IN (?) FOR UPDATE", [orderIds]);
    const itemIds = itemRows.map(row => Number(row.id));
    if (!itemIds.length) throw new DeleteConflict("연결된 주문 항목을 확인할 수 없어 삭제하지 않았습니다.");
    const [sharedItems] = await connection.query<IdRow[]>(
      "SELECT checkout_id AS id FROM checkout_items WHERE order_item_id IN (?) AND checkout_id <> ? LIMIT 1 FOR UPDATE",
      [itemIds, checkoutId]);
    if (sharedItems.length) throw new DeleteConflict("같은 주문에 다른 판매내역이 연결되어 있어 삭제하지 않았습니다.");
    const [externalChildren] = await connection.query<IdRow[]>(
      "SELECT order_item_id AS id FROM order_items WHERE parent_order_item_id IN (?) AND order_item_id NOT IN (?) LIMIT 1 FOR UPDATE",
      [itemIds, itemIds]);
    if (externalChildren.length) throw new DeleteConflict("다른 주문 항목이 구성메뉴를 참조하고 있어 삭제하지 않았습니다.");

    phase = "결제 및 취소 기록 범위 확인";
    const [paymentRows] = await connection.query<PaymentRow[]>(
      "SELECT payment_id AS id, original_payment_id AS parentId FROM payments WHERE checkout_id = ? FOR UPDATE", [checkoutId]);
    const paymentIds = paymentRows.map(row => Number(row.id));
    if (paymentIds.length) {
      const [externalReversals] = await connection.query<IdRow[]>(
        "SELECT payment_id AS id FROM payments WHERE original_payment_id IN (?) AND checkout_id <> ? LIMIT 1 FOR UPDATE",
        [paymentIds, checkoutId]);
      if (externalReversals.length) throw new DeleteConflict("다른 판매의 취소 기록이 연결되어 있어 삭제하지 않았습니다.");

      phase = "고객 거래잔액 반전 및 이력 보존";
      const [ledgerRows] = await connection.query<LedgerRow[]>(
        "SELECT ledger_id AS id, customer_id AS customerId, entry_type AS entryType, amount, memo, reverses_ledger_id AS parentId FROM customer_prepaid_ledger WHERE payment_id IN (?) FOR UPDATE",
        [paymentIds]);
      const sourceIds = new Set(ledgerRows.filter(row => reversalTypes[row.entryType]).map(row => Number(row.id)));
      if (ledgerRows.some(row => !reversalTypes[row.entryType] && !sourceIds.has(Number(row.parentId))))
        throw new DeleteConflict("고객 거래원장의 연결 상태를 확인할 수 없어 삭제하지 않았습니다.");
      if (sourceIds.size) {
        const [reversalRows] = await connection.query<IdRow[]>(
          "SELECT reverses_ledger_id AS id FROM customer_prepaid_ledger WHERE reverses_ledger_id IN (?) FOR UPDATE",
          [[...sourceIds]]);
        const reversed = new Set(reversalRows.map(row => Number(row.id)));
        for (const row of ledgerRows) {
          if (!reversalTypes[row.entryType] || reversed.has(Number(row.id))) continue;
          await connection.query(
            "INSERT INTO customer_prepaid_ledger (customer_id, payment_id, entry_type, amount, memo, reverses_ledger_id, created_by_staff_id) VALUES (?, NULL, ?, ?, ?, ?, ?)",
            [row.customerId, reversalTypes[row.entryType], (-Number(row.amount)).toFixed(2), row.memo, row.id, admin.staffId]);
        }
      }
      // Keep both sides of the signed ledger. Only detach the nullable sale FK.
      await connection.query("UPDATE customer_prepaid_ledger SET payment_id = NULL WHERE payment_id IN (?)", [paymentIds]);
      phase = "payment_session_allocations 삭제";
      await connection.query("DELETE FROM payment_session_allocations WHERE payment_id IN (?)", [paymentIds]);
      phase = "payment_other_details 삭제";
      await connection.query("DELETE FROM payment_other_details WHERE payment_id IN (?)", [paymentIds]);
    }

    phase = "checkout 할인 및 쿠폰 연결 삭제";
    const [children] = await connection.query<RowDataPacket[]>(
      "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'checkouts' AND TABLE_NAME IN ('checkout_discounts', 'coupon_redemptions')");
    // checkout_discounts can also reference coupon_redemptions, so it goes first.
    for (const child of children.sort((a, b) =>
      Number(b.tableName === "checkout_discounts") - Number(a.tableName === "checkout_discounts"))) {
      if (!["checkout_discounts", "coupon_redemptions"].includes(child.tableName) || !/^[a-z_]+$/.test(child.columnName))
        throw new DeleteConflict("판매 할인 연결 구조를 확인할 수 없어 삭제하지 않았습니다.");
      phase = `${child.tableName} 삭제`;
      await connection.query(`DELETE FROM \`${child.tableName}\` WHERE \`${child.columnName}\` = ?`, [checkoutId]);
    }

    if (paymentIds.length) {
      phase = "payments 원결제 및 취소 기록 삭제";
      const remaining = new Set(paymentIds);
      while (remaining.size) {
        const leaves = [...remaining].filter(id => !paymentRows.some(row => remaining.has(Number(row.id)) && Number(row.parentId) === id));
        if (!leaves.length) throw new DeleteConflict("결제 취소 기록의 연결 상태를 확인할 수 없어 삭제하지 않았습니다.");
        await connection.query("DELETE FROM payments WHERE payment_id IN (?)", [leaves]);
        leaves.forEach(id => remaining.delete(id));
      }
    }
    phase = "checkout_items 및 checkouts 삭제";
    await connection.query("DELETE FROM checkout_items WHERE checkout_id = ?", [checkoutId]);
    await connection.query("DELETE FROM checkouts WHERE checkout_id = ?", [checkoutId]);

    phase = "주문 항목 하위 기록 삭제";
    await connection.query("DELETE FROM order_item_cancellations WHERE order_item_id IN (?)", [itemIds]);
    await connection.query("DELETE FROM order_item_options WHERE order_item_id IN (?)", [itemIds]);
    await connection.query("DELETE FROM inventory_transactions WHERE order_item_id IN (?)", [itemIds]);
    const [itemParents] = await connection.query<PaymentRow[]>(
      "SELECT order_item_id AS id, parent_order_item_id AS parentId FROM order_items WHERE order_item_id IN (?)", [itemIds]);
    const remainingItems = new Set(itemIds);
    while (remainingItems.size) {
      const leaves = [...remainingItems].filter(id => !itemParents.some(row => remainingItems.has(Number(row.id)) && Number(row.parentId) === id));
      if (!leaves.length) throw new DeleteConflict("구성메뉴 연결 상태를 확인할 수 없어 삭제하지 않았습니다.");
      await connection.query("DELETE FROM order_items WHERE order_item_id IN (?)", [leaves]);
      leaves.forEach(id => remainingItems.delete(id));
    }
    phase = "QR 접수 주문 연결 해제";
    await connection.query("UPDATE qr_orders SET accepted_order_id = NULL WHERE accepted_order_id IN (?)", [orderIds]);
    phase = "orders 삭제";
    await connection.query("DELETE FROM orders WHERE order_id IN (?)", [orderIds]);

    // Keep sessions with another order, QR request, merge, or payment allocation.
    phase = "비어 있는 table_sessions 정리";
    const [sessions] = await connection.query<RowDataPacket[]>(
      "SELECT session_id, group_id, status FROM table_sessions WHERE session_id IN (?) FOR UPDATE", [sessionIds]);
    const groupIds = [...new Set(sessions.map(row => Number(row.group_id)).filter(Boolean))];
    for (const session of sessions) {
      const sessionId = Number(session.session_id);
      if (session.status === "OPEN") continue;
      const [references] = await connection.query<RowDataPacket[]>(
        "SELECT 1 FROM orders WHERE session_id = ? UNION ALL SELECT 1 FROM payment_session_allocations WHERE session_id = ? UNION ALL SELECT 1 FROM qr_sessions WHERE session_id = ? UNION ALL SELECT 1 FROM table_session_merges WHERE source_session_id = ? OR destination_session_id = ? LIMIT 1",
        [sessionId, sessionId, sessionId, sessionId, sessionId]);
      if (references.length) continue;
      await connection.query("DELETE FROM table_session_discounts WHERE session_id = ?", [sessionId]);
      await connection.query("DELETE FROM table_sessions WHERE session_id = ?", [sessionId]);
    }
    for (const groupId of groupIds) {
      const [members] = await connection.query<RowDataPacket[]>(
        "SELECT 1 FROM table_sessions WHERE group_id = ? LIMIT 1 FOR UPDATE", [groupId]);
      if (!members.length) await connection.query("DELETE FROM party_groups WHERE group_id = ?", [groupId]);
    }

    phase = "판매 삭제 감사 기록";
    await connection.query(
      "INSERT INTO audit_logs (staff_id, action_type, entity_type, entity_id, description) VALUES (?, 'DELETE_SALE', 'CHECKOUT', ?, ?)",
      [admin.staffId, checkoutId, JSON.stringify({ paymentCount: paymentIds.length, orderCount: orderIds.length, sessionCount: sessionIds.length })]);
    await connection.commit();
    return Response.json({ success: true });
  } catch (error) {
    await connection.rollback();
    if (error instanceof DeleteConflict) return Response.json({ success: false, message: error.message }, { status: 409 });
    console.error("admin sale delete failed", { checkoutId, phase, error });
    return Response.json({ success: false, message: "판매내역을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  } finally {
    connection.release();
  }
}
