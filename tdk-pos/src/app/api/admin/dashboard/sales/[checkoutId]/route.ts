import type { RowDataPacket } from "mysql2";
import { pool } from "@/db";
import { getCurrentAdminStaff } from "@/lib/admin-auth";

class DeleteConflict extends Error {}
type IdRow = RowDataPacket & { id: number };

export async function DELETE(_request: Request, context: { params: Promise<{ checkoutId: string }> }) {
  if (!await getCurrentAdminStaff()) return Response.json({ success: false, message: "OWNER 권한이 필요합니다." }, { status: 403 });
  const checkoutId = Number((await context.params).checkoutId);
  if (!Number.isSafeInteger(checkoutId) || checkoutId <= 0) return Response.json({ success: false, message: "판매내역을 확인해 주세요." }, { status: 400 });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [checkout] = await connection.query<RowDataPacket[]>("SELECT checkout_id, status FROM checkouts WHERE checkout_id = ? FOR UPDATE", [checkoutId]);
    if (!checkout.length) throw new DeleteConflict("이미 삭제되었거나 존재하지 않는 판매내역입니다.");

    const [sessionRows] = await connection.query<IdRow[]>(
      "SELECT DISTINCT o.session_id AS id FROM checkout_items ci JOIN order_items oi ON oi.order_item_id = ci.order_item_id JOIN orders o ON o.order_id = oi.order_id WHERE ci.checkout_id = ?", [checkoutId]);
    const sessionIds = sessionRows.map(row => Number(row.id));
    if (!sessionIds.length) throw new DeleteConflict("연결된 테이블 이용을 확인할 수 없어 삭제할 수 없습니다.");
    const [sessions] = await connection.query<RowDataPacket[]>("SELECT session_id, group_id, status FROM table_sessions WHERE session_id IN (?) FOR UPDATE", [sessionIds]);
    if (sessions.length !== sessionIds.length || sessions.some(row => row.status === "OPEN"))
      throw new DeleteConflict("테이블 이용 중이거나 거래 연결이 변경되어 삭제할 수 없습니다.");
    const groupIds = [...new Set(sessions.map(row => Number(row.group_id)).filter(Boolean))];
    if (groupIds.length) {
      const [groupSessions] = await connection.query<IdRow[]>("SELECT session_id AS id FROM table_sessions WHERE group_id IN (?) FOR UPDATE", [groupIds]);
      if (groupSessions.some(row => !sessionIds.includes(Number(row.id))))
        throw new DeleteConflict("다른 판매내역과 연결된 합석 기록이 있어 삭제할 수 없습니다.");
    }

    const [allItems] = await connection.query<IdRow[]>(
      "SELECT oi.order_item_id AS id FROM order_items oi JOIN orders o ON o.order_id = oi.order_id WHERE o.session_id IN (?) FOR UPDATE", [sessionIds]);
    const itemIds = allItems.map(row => Number(row.id));
    const [checkoutItems] = await connection.query<IdRow[]>("SELECT order_item_id AS id FROM checkout_items WHERE checkout_id = ? FOR UPDATE", [checkoutId]);
    const targetItemIds = new Set(checkoutItems.map(row => Number(row.id)));
    if (itemIds.some(id => !targetItemIds.has(id)))
      throw new DeleteConflict("같은 테이블 이용에 다른 주문이 있어 이 판매내역만 삭제할 수 없습니다.");
    const [otherCheckoutItems] = await connection.query<IdRow[]>(
      "SELECT checkout_id AS id FROM checkout_items WHERE order_item_id IN (?) AND checkout_id <> ? LIMIT 1 FOR UPDATE", [itemIds, checkoutId]);
    if (otherCheckoutItems.length)
      throw new DeleteConflict("주문 항목이 다른 판매내역에도 연결되어 있어 삭제할 수 없습니다.");
    const [orderRows] = await connection.query<IdRow[]>("SELECT order_id AS id FROM orders WHERE session_id IN (?) FOR UPDATE", [sessionIds]);
    const orderIds = orderRows.map(row => Number(row.id));
    if (!orderIds.length) throw new DeleteConflict("주문 연결을 확인할 수 없습니다.");
    const [mergeRows] = await connection.query<RowDataPacket[]>(
      "SELECT source_session_id, destination_session_id FROM table_session_merges WHERE source_session_id IN (?) OR destination_session_id IN (?) FOR UPDATE", [sessionIds, sessionIds]);
    if (mergeRows.some(row => !sessionIds.includes(Number(row.source_session_id)) || !sessionIds.includes(Number(row.destination_session_id))))
      throw new DeleteConflict("다른 테이블 이용과 연결된 합석 기록이 있어 삭제할 수 없습니다.");

    const [paymentRows] = await connection.query<RowDataPacket[]>("SELECT payment_id AS id, original_payment_id AS parentId FROM payments WHERE checkout_id = ? FOR UPDATE", [checkoutId]);
    const paymentIds = paymentRows.map(row => Number(row.id));
    // Reversal entries point to the original ledger row. Remove children first.
    if (paymentIds.length) {
      const [ledgerRows] = await connection.query<RowDataPacket[]>(
        "SELECT ledger_id AS id, reverses_ledger_id AS parentId FROM customer_prepaid_ledger WHERE payment_id IN (?) FOR UPDATE", [paymentIds]);
      const remaining = new Set(ledgerRows.map(row => Number(row.id)));
      while (remaining.size) {
        const leaves = [...remaining].filter(id => !ledgerRows.some(row => remaining.has(Number(row.id)) && Number(row.parentId) === id));
        if (!leaves.length) throw new DeleteConflict("고객 거래원장 연결을 확인할 수 없습니다.");
        await connection.query("DELETE FROM customer_prepaid_ledger WHERE ledger_id IN (?)", [leaves]);
        leaves.forEach(id => remaining.delete(id));
      }
      await connection.query("DELETE FROM payment_other_details WHERE payment_id IN (?)", [paymentIds]);
    }
    // These historic checkout child tables are present in some deployments.
    const [children] = await connection.query<RowDataPacket[]>(
      "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'checkouts' AND TABLE_NAME IN ('checkout_discounts', 'coupon_redemptions')");
    for (const child of children) {
      if (!["checkout_discounts", "coupon_redemptions"].includes(child.tableName) || !/^[a-z_]+$/.test(child.columnName)) throw new DeleteConflict("거래 연결 구조를 확인할 수 없습니다.");
      await connection.query(`DELETE FROM \`${child.tableName}\` WHERE \`${child.columnName}\` = ?`, [checkoutId]);
    }
    if (paymentIds.length) {
      const remainingPayments = new Set(paymentIds);
      while (remainingPayments.size) {
        const leaves = [...remainingPayments].filter(id => !paymentRows.some(row => remainingPayments.has(Number(row.id)) && Number(row.parentId) === id));
        if (!leaves.length) throw new DeleteConflict("결제 원거래 연결을 확인할 수 없습니다.");
        await connection.query("DELETE FROM payments WHERE payment_id IN (?)", [leaves]);
        leaves.forEach(id => remainingPayments.delete(id));
      }
    }
    await connection.query("DELETE FROM checkout_items WHERE checkout_id = ?", [checkoutId]);
    await connection.query("DELETE FROM checkouts WHERE checkout_id = ?", [checkoutId]);

    await connection.query("DELETE FROM order_item_cancellations WHERE order_item_id IN (?)", [itemIds]);
    await connection.query("DELETE FROM order_item_options WHERE order_item_id IN (?)", [itemIds]);
    await connection.query("DELETE FROM inventory_transactions WHERE order_item_id IN (?)", [itemIds]);
    const [itemParents] = await connection.query<RowDataPacket[]>(
      "SELECT order_item_id AS id, parent_order_item_id AS parentId FROM order_items WHERE order_item_id IN (?)", [itemIds]);
    const remainingItems = new Set(itemIds);
    while (remainingItems.size) {
      const leaves = [...remainingItems].filter(id => !itemParents.some(row => remainingItems.has(Number(row.id)) && Number(row.parentId) === id));
      if (!leaves.length) throw new DeleteConflict("주문 항목 연결을 확인할 수 없습니다.");
      await connection.query("DELETE FROM order_items WHERE order_item_id IN (?)", [leaves]);
      leaves.forEach(id => remainingItems.delete(id));
    }
    const [qrSessionRows] = await connection.query<IdRow[]>("SELECT qr_session_id AS id FROM qr_sessions WHERE session_id IN (?) FOR UPDATE", [sessionIds]);
    const qrSessionIds = qrSessionRows.map(row => Number(row.id));
    if (qrSessionIds.length) {
      const [qrOrderRows] = await connection.query<IdRow[]>("SELECT qr_order_id AS id FROM qr_orders WHERE qr_session_id IN (?) FOR UPDATE", [qrSessionIds]);
      const qrOrderIds = qrOrderRows.map(row => Number(row.id));
      if (qrOrderIds.length) {
        const [qrOrderItemRows] = await connection.query<IdRow[]>("SELECT qr_order_item_id AS id FROM qr_order_items WHERE qr_order_id IN (?)", [qrOrderIds]);
        const qrOrderItemIds = qrOrderItemRows.map(row => Number(row.id));
        if (qrOrderItemIds.length) await connection.query("DELETE FROM qr_order_item_options WHERE qr_order_item_id IN (?)", [qrOrderItemIds]);
        await connection.query("DELETE FROM qr_order_items WHERE qr_order_id IN (?)", [qrOrderIds]);
        await connection.query("DELETE FROM qr_orders WHERE qr_order_id IN (?)", [qrOrderIds]);
      }
      const [qrCartRows] = await connection.query<IdRow[]>("SELECT cart_item_id AS id FROM qr_cart_items WHERE qr_session_id IN (?)", [qrSessionIds]);
      const qrCartIds = qrCartRows.map(row => Number(row.id));
      if (qrCartIds.length) await connection.query("DELETE FROM qr_cart_item_options WHERE cart_item_id IN (?)", [qrCartIds]);
      await connection.query("DELETE FROM qr_cart_items WHERE qr_session_id IN (?)", [qrSessionIds]);
      await connection.query("DELETE FROM qr_sessions WHERE qr_session_id IN (?)", [qrSessionIds]);
    }
    await connection.query("DELETE FROM orders WHERE order_id IN (?)", [orderIds]);
    await connection.query("DELETE FROM table_session_discounts WHERE session_id IN (?)", [sessionIds]);
    await connection.query("DELETE FROM table_session_merges WHERE source_session_id IN (?) OR destination_session_id IN (?)", [sessionIds, sessionIds]);
    await connection.query("DELETE FROM table_sessions WHERE session_id IN (?)", [sessionIds]);
    if (groupIds.length) await connection.query("DELETE FROM party_groups WHERE group_id IN (?)", [groupIds]);
    await connection.commit();
    return Response.json({ success: true });
  } catch (error) {
    await connection.rollback();
    if (error instanceof DeleteConflict) return Response.json({ success: false, message: error.message }, { status: 409 });
    console.error("admin sale delete failed", error);
    return Response.json({ success: false, message: "판매내역을 삭제할 수 없습니다. 연결된 거래 기록을 확인해 주세요." }, { status: 500 });
  } finally {
    connection.release();
  }
}
