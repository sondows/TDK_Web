/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS test script */
// TEST-only sale flow. Cleans every row linked to its own request key in finally.
const assert = require("node:assert/strict");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local"), quiet: true });
if (process.env.DB_NAME !== "TDK_POS_TEST") throw new Error("TDK_POS_TEST only");
const mysql = require("mysql2/promise");

const baseUrl = process.env.TAKEOUT_TEST_BASE_URL || "http://127.0.0.1:3105";
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const adminToken = `admin.${randomBytes(32).toString("base64url")}`;
const adminTokenHash = createHash("sha256").update(adminToken).digest("hex");
const requestKey = randomUUID();
const paymentMode = ["CARD", "CUSTOMER"].includes(process.env.TAKEOUT_TEST_PAYMENT_MODE) ? process.env.TAKEOUT_TEST_PAYMENT_MODE : "MIXED";
const takeoutKind = process.env.TAKEOUT_TEST_KIND === "TAKEOUT_PHONE" ? "TAKEOUT_PHONE" : "TAKEOUT_WALK_IN";
const dineIn = process.env.TAKEOUT_TEST_DINE_IN === "1";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function api(pathname, method = "GET", body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { Cookie: `tdk_pos_session=${token}; tdk_admin_session=${adminToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}

async function cleanup(connection, dineInSessionId, dineInTableId) {
  const [rows] = dineIn && dineInSessionId
    ? await connection.query("SELECT session_id FROM table_sessions WHERE session_id = ? AND table_id = ?", [dineInSessionId, dineInTableId])
    : await connection.query("SELECT session_id FROM table_sessions WHERE create_request_key = ?", [requestKey]);
  if (!rows.length) return;
  const sessionId = rows[0].session_id;
  await connection.beginTransaction();
  try {
    const [orderRows] = await connection.query("SELECT order_id FROM orders WHERE session_id = ?", [sessionId]);
    const orderIds = orderRows.map(row => row.order_id);
    const [itemRows] = orderIds.length ? await connection.query("SELECT order_item_id FROM order_items WHERE order_id IN (?)", [orderIds]) : [[]];
    const itemIds = itemRows.map(row => row.order_item_id);
    const [checkoutRows] = itemIds.length ? await connection.query("SELECT DISTINCT checkout_id FROM checkout_items WHERE order_item_id IN (?)", [itemIds]) : [[]];
    const checkoutIds = checkoutRows.map(row => row.checkout_id);
    const [paymentRows] = checkoutIds.length ? await connection.query("SELECT payment_id FROM payments WHERE checkout_id IN (?)", [checkoutIds]) : [[]];
    const paymentIds = paymentRows.map(row => row.payment_id);
    if (paymentIds.length) {
      await connection.query("DELETE FROM payment_session_allocations WHERE payment_id IN (?)", [paymentIds]);
      await connection.query("DELETE FROM payment_other_details WHERE payment_id IN (?)", [paymentIds]);
      await connection.query("DELETE FROM customer_prepaid_ledger WHERE payment_id IN (?)", [paymentIds]);
      await connection.query("DELETE FROM payments WHERE payment_id IN (?)", [paymentIds]);
    }
    if (checkoutIds.length) {
      await connection.query("DELETE FROM checkout_discounts WHERE checkout_id IN (?)", [checkoutIds]);
      await connection.query("DELETE FROM coupon_redemptions WHERE checkout_id IN (?)", [checkoutIds]);
      await connection.query("DELETE FROM checkout_items WHERE checkout_id IN (?)", [checkoutIds]);
      await connection.query("DELETE FROM checkouts WHERE checkout_id IN (?)", [checkoutIds]);
    }
    if (itemIds.length) {
      await connection.query("DELETE FROM inventory_transactions WHERE order_item_id IN (?)", [itemIds]);
      await connection.query("DELETE FROM order_item_cancellations WHERE order_item_id IN (?)", [itemIds]);
      await connection.query("DELETE FROM order_item_options WHERE order_item_id IN (?)", [itemIds]);
      await connection.query("DELETE FROM order_items WHERE order_item_id IN (?) AND parent_order_item_id IS NOT NULL", [itemIds]);
      await connection.query("DELETE FROM order_items WHERE order_item_id IN (?)", [itemIds]);
    }
    if (orderIds.length) await connection.query("DELETE FROM orders WHERE order_id IN (?)", [orderIds]);
    await connection.query("DELETE FROM table_session_discounts WHERE session_id = ?", [sessionId]);
    if (dineIn) await connection.query("DELETE FROM table_sessions WHERE session_id = ? AND table_id = ?", [sessionId, dineInTableId]);
    else await connection.query("DELETE FROM table_sessions WHERE session_id = ? AND create_request_key = ?", [sessionId, requestKey]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

(async () => {
  const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  let staffSessionId;
  let adminSessionId;
  let customerId;
  let dineInSessionId;
  let dineInTableId;
  let dineInTableNo;
  try {
    const [staff] = await connection.query("SELECT staff_id FROM staff WHERE staff_code = '000' AND is_active = 1 LIMIT 1");
    assert(staff.length, "active shared staff required");
    const [login] = await connection.query("INSERT INTO staff_sessions (staff_id, session_token_hash, status) VALUES (?, ?, 'ACTIVE')", [staff[0].staff_id, tokenHash]);
    staffSessionId = login.insertId;
    const [owner] = await connection.query("SELECT staff_id FROM staff WHERE role = 'OWNER' AND is_active = 1 AND admin_login_id IS NOT NULL AND admin_pin_hash IS NOT NULL LIMIT 1");
    assert(owner.length, "active owner with admin credentials required");
    const [adminLogin] = await connection.query("INSERT INTO staff_sessions (staff_id, session_token_hash, status) VALUES (?, ?, 'ACTIVE')", [owner[0].staff_id, adminTokenHash]);
    adminSessionId = adminLogin.insertId;
    const beforeAdmin = await api(`/api/admin/sales-report?view=daily&startDate=${today}&endDate=${today}`);
    const beforeItems = await api(`/api/admin/item-sales?startDate=${today}&endDate=${today}`);
    assert.equal(beforeAdmin.status, 200, JSON.stringify(beforeAdmin.data));
    assert.equal(beforeItems.status, 200, JSON.stringify(beforeItems.data));

    let sessionId;
    if (dineIn) {
      const [available] = await connection.query("SELECT dt.table_id, dt.table_no FROM dining_tables dt WHERE dt.is_active = 1 AND NOT EXISTS (SELECT 1 FROM table_sessions ts WHERE ts.table_id = dt.table_id AND ts.status = 'OPEN') ORDER BY dt.table_id LIMIT 1");
      assert(available.length, "no unused test table");
      dineInTableId = available[0].table_id;
      dineInTableNo = available[0].table_no;
      const created = await api("/api/table-sessions", "POST", { tableId: dineInTableId, personCount: 1, babyCount: 0 });
      assert.equal(created.status, 200, JSON.stringify(created.data));
      dineInSessionId = created.data.sessionId;
      sessionId = dineInSessionId;
    } else {
      const created = await api("/api/pos/takeouts", "POST", { kind: takeoutKind, requestKey });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      sessionId = created.data.session.sessionId;
    }
    const checkoutTarget = dineIn ? { tableId: dineInTableId } : { sessionId };
    const checkoutQuery = dineIn ? `tableId=${dineInTableId}` : `sessionId=${sessionId}`;
    const invalidOption = await api(`/api/table-sessions/${sessionId}/orders`, "POST", { items: [{ menuId: 6, qty: 1, options: [{ modifierOptionId: 3, qty: 1 }] }] });
    assert.equal(invalidOption.status, 409, JSON.stringify(invalidOption.data));
    const ordered = await api(`/api/table-sessions/${sessionId}/orders`, "POST", { items: [{ menuId: 1, qty: 2, options: [{ modifierOptionId: 3, qty: 1 }], components: [{ menuComponentId: 1, qty: 0 }] }] });
    assert.equal(ordered.status, 200, JSON.stringify(ordered.data));
    const [savedOption] = await connection.query("SELECT oio.option_name, oio.qty FROM order_item_options oio JOIN order_items oi ON oi.order_item_id = oio.order_item_id JOIN orders o ON o.order_id = oi.order_id WHERE o.session_id = ?", [sessionId]);
    assert.equal(savedOption.length, 1);
    assert.equal(savedOption[0].qty, 2);
    const discounted = await api(`/api/table-sessions/${sessionId}/discounts`, "POST", { discounts: [{ type: "AMOUNT", amount: 1000 }] });
    assert.equal(discounted.status, 200, JSON.stringify(discounted.data));
    if (!dineIn) {
      const blockedCancel = await api("/api/pos/takeouts", "DELETE", { sessionId });
      assert.equal(blockedCancel.status, 409);
    }
    const initial = await api(`/api/checkouts?${checkoutQuery}`);
    assert.equal(initial.status, 200, JSON.stringify(initial.data));
    assert.equal(initial.data.gross, 20000);
    assert.equal(initial.data.total, 19000);
    assert.equal(initial.data.remaining, 19000);
    let full;
    if (paymentMode === "CARD") {
      full = await api("/api/checkouts", "POST", { ...checkoutTarget, action: "PAY", methodCode: "CARD", amount: 19000 });
    } else if (paymentMode === "CUSTOMER") {
      const [customer] = await connection.query("INSERT INTO customers (name, is_payment_managed, auto_print_sign_receipt) VALUES (?, 1, 0)", [`__TAKEOUT_TEST_${requestKey}`]);
      customerId = customer.insertId;
      full = await api("/api/checkouts", "POST", { ...checkoutTarget, action: "PAY_CUSTOMER", customerId, amount: 19000, requestKey: randomUUID() });
      const [ledger] = await connection.query("SELECT amount, entry_type FROM customer_prepaid_ledger WHERE customer_id = ?", [customerId]);
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].entry_type, "CUSTOMER_PAYMENT");
      assert.equal(Number(ledger[0].amount), -19000);
    } else {
      const partial = await api("/api/checkouts", "POST", { ...checkoutTarget, action: "PAY", methodCode: "CASH", amount: 5000 });
      assert.equal(partial.status, 200, JSON.stringify(partial.data));
      assert.equal(partial.data.completed, false);
      const afterPartial = await api(`/api/checkouts?${checkoutQuery}`);
      assert.equal(afterPartial.data.remaining, 14000);
      const partialPaymentId = afterPartial.data.payments.find(payment => payment.methodCode === "CASH").paymentId;
      const cancelledPayment = await api("/api/checkouts", "POST", { ...checkoutTarget, action: "CANCEL_PAYMENT", paymentId: partialPaymentId });
      assert.equal(cancelledPayment.status, 200, JSON.stringify(cancelledPayment.data));
      const afterCancel = await api(`/api/checkouts?${checkoutQuery}`);
      assert.equal(afterCancel.data.remaining, 19000);
      const restoredCash = await api("/api/checkouts", "POST", { ...checkoutTarget, action: "PAY", methodCode: "CASH", amount: 5000 });
      assert.equal(restoredCash.status, 200, JSON.stringify(restoredCash.data));
      const [openAfterPartial] = await connection.query("SELECT status FROM table_sessions WHERE session_id = ?", [sessionId]);
      assert.equal(openAfterPartial[0].status, "OPEN");
      full = await api("/api/checkouts", "POST", { ...checkoutTarget, action: "PAY_OTHER", paymentMethodId: 5, inputValue: 14000, quantityMode: false });
    }
    assert.equal(full.status, 200, JSON.stringify(full.data));
    assert.equal(full.data.completed, true);
    const [openAfterPaid] = await connection.query("SELECT status FROM table_sessions WHERE session_id = ?", [sessionId]);
    assert.equal(openAfterPaid[0].status, "OPEN", "zero balance must not close the session");
    const checkoutId = full.data.completedCheckoutIds[0];
    const completed = await api("/api/checkouts", "POST", { ...checkoutTarget, action: "COMPLETE" });
    assert.equal(completed.status, 200, JSON.stringify(completed.data));
    const [closed] = await connection.query("SELECT status FROM table_sessions WHERE session_id = ?", [sessionId]);
    assert.equal(closed[0].status, "CLOSED");
    const duplicateCompletion = await api("/api/checkouts", "POST", { ...checkoutTarget, action: "COMPLETE" });
    assert.equal(duplicateCompletion.status, 404);
    const openList = await api("/api/pos/takeouts");
    assert(!openList.data.sessions.some(session => session.sessionId === sessionId));
    const sale = await api(`/api/sales?checkoutId=${checkoutId}`);
    assert.equal(sale.status, 200, JSON.stringify(sale.data));
    const receipt = await api("/api/sales", "POST", { checkoutId });
    assert.equal(receipt.status, 200, JSON.stringify(receipt.data));
    assert.match(receipt.data.receipt.tableLabel, dineIn ? new RegExp(`${dineInTableNo}T`) : /^포장\d{4}/);
    assert.equal(receipt.data.receipt.discountAmount, 1000);
    const admin = await api(`/api/admin/sales-report?view=daily&startDate=${today}&endDate=${today}`);
    const items = await api(`/api/admin/item-sales?startDate=${today}&endDate=${today}`);
    const details = await api(`/api/admin/sales-report/details?startDate=${today}&endDate=${today}`);
    assert.equal(admin.status, 200, JSON.stringify(admin.data));
    assert.equal(items.status, 200, JSON.stringify(items.data));
    assert.equal(details.status, 200, JSON.stringify(details.data));
    assert.equal(admin.data.totals.salesAmount - beforeAdmin.data.totals.salesAmount, 19000);
    const itemQty = response => response.data.rows.find(row => row.menuId === 1)?.qty ?? 0;
    assert.equal(itemQty(items) - itemQty(beforeItems), 2);
    assert(details.data.rows.some(row => row.checkoutId === checkoutId && (dineIn ? row.tableLabel === `${dineInTableNo}T` : /^포장\d{4}/.test(row.tableLabel))));
    console.log(JSON.stringify({ database: "TDK_POS_TEST", result: "PASS", sessionId, checkoutId, kind: dineIn ? "DINE_IN" : takeoutKind, gross: 20000, discount: 1000, optionSaved: true, paymentMode, cancelledPartialPayment: paymentMode === "MIXED", openAtZeroBeforeFinalComplete: true, closedAfterFinalComplete: true, saleDetail: true, receiptPrepared: true, adminSales: true, adminItemSales: true }));
  } finally {
    try {
      await cleanup(connection, dineInSessionId, dineInTableId);
      if (customerId) {
        await connection.query("DELETE FROM customer_prepaid_ledger WHERE customer_id = ?", [customerId]);
        await connection.query("DELETE FROM customers WHERE customer_id = ? AND name = ?", [customerId, `__TAKEOUT_TEST_${requestKey}`]);
      }
      if (staffSessionId) await connection.query("DELETE FROM staff_sessions WHERE staff_session_id = ? AND session_token_hash = ?", [staffSessionId, tokenHash]);
      if (adminSessionId) await connection.query("DELETE FROM staff_sessions WHERE staff_session_id = ? AND session_token_hash = ?", [adminSessionId, adminTokenHash]);
    } finally { await connection.end(); }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
