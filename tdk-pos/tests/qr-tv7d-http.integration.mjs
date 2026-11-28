import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local", quiet: true });
assert.equal(process.env.DB_NAME, "TDK_POS_TEST", "Development DB only");
const base = new URL(process.env.QR_TEST_HTTP_BASE_URL ?? "http://127.0.0.1:3107");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: "TDK_POS_TEST" });
const tag = randomBytes(7).toString("hex");
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const identifier = Array.from(randomBytes(16), byte => alphabet[byte % alphabet.length]).join("");
const fixture = { table: null, code: null, visit: null, interimVisit: null, visitB: null, visitC: null, customers: [], attempts: [], qrOrders: [], orders: [], checkouts: [],
  trust: null, staffSession: null, hosTrust: null, hosStaffSession: null, adminTrust: null, adminStaffSession: null,
  openingFundId: null, openingBusinessDate: null };
const one = async (sql, args = []) => (await db.execute(sql, args))[0][0] ?? null;
const call = async (path, { method = "GET", cookie, body } = {}) => {
  const response = await fetch(new URL(path, base), { method, redirect: "manual", cache: "no-store",
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { origin: base.origin, "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const payload = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
  return { status: response.status, body: payload, response };
};
const order = (cookie, requestId, cart, authAttemptId) => call("/api/qr/table-orders", {
  method: "POST", cookie, body: { requestId, cart, ...(authAttemptId ? { authAttemptId } : {}) } });
const cookieFrom = response => {
  const value = response.headers.get("set-cookie")?.match(/tdkon_qr_session=([^;,]+)/)?.[1];
  assert.ok(value, "QR entry must issue a session cookie");
  return `tdkon_qr_session=${value}`;
};
let initialCode;
let codeTouched = false;

async function cleanup() {
  if (fixture.table !== null) {
    await db.beginTransaction();
    try {
      await db.execute("DELETE FROM qr_order_auth_attempts WHERE table_id=?", [fixture.table]);
      await db.execute("DELETE FROM qr_table_order_claims WHERE table_id=?", [fixture.table]);
      const [allOrders] = await db.execute(`SELECT o.qr_order_id AS id FROM qr_orders o
        INNER JOIN qr_sessions s ON s.qr_session_id=o.qr_session_id WHERE s.table_id=?`, [fixture.table]);
      for (const id of allOrders.map(row => Number(row.id))) {
        const accepted = await one("SELECT accepted_order_id FROM qr_orders WHERE qr_order_id=?", [id]);
        if (accepted?.accepted_order_id) fixture.orders.push(Number(accepted.accepted_order_id));
        await db.execute("DELETE FROM qr_order_item_options WHERE qr_order_item_id IN (SELECT qr_order_item_id FROM qr_order_items WHERE qr_order_id=?)", [id]);
        await db.execute("DELETE FROM qr_order_items WHERE qr_order_id=?", [id]);
        await db.execute("DELETE FROM qr_orders WHERE qr_order_id=?", [id]);
      }
      for (const id of fixture.checkouts) {
        await db.execute("DELETE FROM payment_session_allocations WHERE payment_id IN (SELECT payment_id FROM payments WHERE checkout_id=?)", [id]);
        await db.execute("DELETE FROM payments WHERE checkout_id=?", [id]);
        await db.execute("DELETE FROM checkout_items WHERE checkout_id=?", [id]);
        await db.execute("DELETE FROM checkouts WHERE checkout_id=?", [id]);
      }
      for (const id of new Set(fixture.orders)) {
        await db.execute("DELETE FROM order_item_options WHERE order_item_id IN (SELECT order_item_id FROM order_items WHERE order_id=?)", [id]);
        await db.execute("DELETE FROM order_items WHERE order_id=?", [id]);
        await db.execute("DELETE FROM orders WHERE order_id=?", [id]);
      }
      for (const id of fixture.customers) await db.execute("DELETE FROM qr_sessions WHERE qr_session_id=?", [id]);
      if (fixture.visitC !== null) await db.execute("DELETE FROM table_sessions WHERE session_id=?", [fixture.visitC]);
      if (fixture.visitB !== null) await db.execute("DELETE FROM table_sessions WHERE session_id=?", [fixture.visitB]);
      if (fixture.interimVisit !== null) await db.execute("DELETE FROM table_sessions WHERE session_id=?", [fixture.interimVisit]);
      if (fixture.visit !== null) await db.execute("DELETE FROM table_sessions WHERE session_id=?", [fixture.visit]);
      if (fixture.staffSession !== null) await db.execute("DELETE FROM staff_sessions WHERE staff_session_id=?", [fixture.staffSession]);
      if (fixture.trust !== null) await db.execute("DELETE FROM program_trust_tokens WHERE token_id=?", [fixture.trust]);
      if (fixture.hosStaffSession !== null) await db.execute("DELETE FROM staff_sessions WHERE staff_session_id=?", [fixture.hosStaffSession]);
      if (fixture.hosTrust !== null) await db.execute("DELETE FROM program_trust_tokens WHERE token_id=?", [fixture.hosTrust]);
      if (fixture.adminStaffSession !== null) await db.execute("DELETE FROM staff_sessions WHERE staff_session_id=?", [fixture.adminStaffSession]);
      if (fixture.adminTrust !== null) await db.execute("DELETE FROM program_trust_tokens WHERE token_id=?", [fixture.adminTrust]);
      if (fixture.code !== null) {
        await db.execute("DELETE FROM qr_table_links WHERE qr_code_id=?", [fixture.code]);
        await db.execute("DELETE FROM audit_logs WHERE entity_type='QR_CODE' AND entity_id=?", [fixture.code]);
        await db.execute("DELETE FROM qr_codes WHERE qr_code_id=? AND identifier=?", [fixture.code, identifier]);
      }
      await db.execute("DELETE FROM dining_tables WHERE table_id=? AND table_no=?", [fixture.table, `ZZ7D${tag}`]);
      await db.commit();
    } catch (error) { await db.rollback(); throw error; }
  }
  if (codeTouched) {
    await db.execute(`UPDATE tv_qr_auth_code_state SET issuance_id=?,code=?,issued_at=?,last_requested_at=?,
      expires_at=?,state_version=?,updated_at=? WHERE state_id=1`, [initialCode.issuance_id, initialCode.code,
      initialCode.issued_at, initialCode.last_requested_at, initialCode.expires_at, initialCode.state_version,
      initialCode.updated_at]);
  }
  if (fixture.openingFundId !== null) {
    const [removed] = await db.execute(`DELETE FROM cash_opening_funds WHERE cash_opening_fund_id=?
      AND business_date=? AND total_amount=0 AND other_amount=0 AND count_50000=0 AND count_10000=0
      AND count_5000=0 AND count_1000=0 AND count_500=0 AND count_100=0`,
    [fixture.openingFundId, fixture.openingBusinessDate]);
    assert.equal(removed.affectedRows, 1, "Temporary opening fund changed outside the fixture; preserve it for review");
  }
  assert.equal(Number((await one("SELECT COUNT(*) n FROM dining_tables WHERE table_no=?", [`ZZ7D${tag}`])).n), 0);
  assert.equal(Number((await one("SELECT COUNT(*) n FROM qr_order_auth_attempts WHERE table_id=?", [fixture.table])).n), 0);
  assert.equal(Number((await one("SELECT COUNT(*) n FROM qr_table_order_claims WHERE table_id=?", [fixture.table])).n), 0);
}

try {
  assert.equal((await one("SELECT DATABASE() db")).db, "TDK_POS_TEST");
  assert.equal((await call("/api/db-test")).body?.result?.[0]?.database_name, "TDK_POS_TEST");
  const staff = await one("SELECT staff_id FROM staff WHERE is_active=1 AND pos_enabled=1 AND hos_enabled=1 AND admin_enabled=1 AND employee_pin_hash IS NOT NULL AND staff_code<>'000' ORDER BY staff_id LIMIT 1");
  assert.ok(staff, "Active POS test staff required");
  initialCode = await one("SELECT * FROM tv_qr_auth_code_state WHERE state_id=1");
  assert.ok(initialCode);
  assert.equal(initialCode.issuance_id, null, "Refusing to disturb existing TV code");
  assert.equal(initialCode.code, null, "Refusing to disturb existing TV code");
  assert.equal(Number(initialCode.state_version), 0, "Refusing to disturb existing TV code history");
  assert.equal(Number((await one("SELECT is_active FROM tv_business_notice WHERE notice_id=1")).is_active), 0);
  // Compile each route before starting the ten-second verification window.
  await Promise.all([call("/api/qr/order-auth"), call("/api/qr/order-auth/verify", { method: "POST", body: {} }),
    call("/api/qr/table-orders"), call("/api/pos/qr-table-orders", { method: "PATCH", body: {} }),
    call("/api/hos/qr-auth-code"), call("/api/tdktv/qr-auth-code")]);
  const openingSetting = await one("SELECT setting_value FROM system_settings WHERE setting_key='business_opening_cash_enabled'");
  if (openingSetting?.setting_value === "1") {
    fixture.openingBusinessDate = (await one("SELECT DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d') AS businessDate")).businessDate;
    const opening = await one("SELECT cash_opening_fund_id FROM cash_opening_funds WHERE business_date=?", [fixture.openingBusinessDate]);
    if (!opening) {
      const [created] = await db.execute(`INSERT INTO cash_opening_funds
        (business_date,created_by_staff_id,updated_by_staff_id) VALUES (?,?,?)`,
      [fixture.openingBusinessDate, staff.staff_id, staff.staff_id]);
      fixture.openingFundId = Number(created.insertId);
    }
  }
  fixture.table = Number((await db.execute("INSERT INTO dining_tables (table_no,capacity,is_active) VALUES (?,8,1)", [`ZZ7D${tag}`]))[0].insertId);
  fixture.code = Number((await db.execute("INSERT INTO qr_codes (identifier,management_number,target_type,status,created_by_staff_id) VALUES (?,?,'TABLE_ORDER','IN_USE',?)", [identifier, `ZZ7M${tag}`, staff.staff_id]))[0].insertId);
  await db.execute("INSERT INTO qr_table_links (qr_code_id,table_id,assigned_by_staff_id) VALUES (?,?,?)", [fixture.code, fixture.table, staff.staff_id]);
  fixture.visit = Number((await db.execute("INSERT INTO table_sessions (table_id,status,session_kind,opened_by_staff_id) VALUES (?,'OPEN','DINE_IN',?)", [fixture.table, staff.staff_id]))[0].insertId);
  const scans = await Promise.all([call(`/tdkqrs/${identifier}`), call(`/tdkqrs/${identifier}`)]);
  for (const scan of scans) assert.equal(new URL(scan.response.headers.get("location"), base).pathname, "/qrorder/order");
  const cookies = scans.map(scan => cookieFrom(scan.response));
  for (const cookie of cookies) {
    const hash = createHash("sha256").update(decodeURIComponent(cookie.split("=")[1])).digest("hex");
    fixture.customers.push(Number((await one("SELECT qr_session_id FROM qr_sessions WHERE token_hash=?", [hash])).qr_session_id));
  }
  const catalog = (await call("/api/qr/menu-catalog")).body;
  const menu = catalog.menus.find(item => !catalog.modifierGroups.some(group =>
    Number(group.menuId) === Number(item.menuId) && (group.isRequired || Number(group.minSelect) > 0)));
  assert.ok(menu, "Menu without required modifiers required");
  const cart = [{ menuId: Number(menu.menuId), qty: 1, options: [] }];
  const requestIds = [randomUUID(), randomUUID()];
  assert.equal((await order(cookies[0], requestIds[0], cart)).body.code, "AUTH_REQUIRED");
  const auths = await Promise.all(cookies.map((cookie, index) => call("/api/qr/order-auth", {
    method: "POST", cookie, body: { requestId: requestIds[index], cart } })));
  for (const auth of auths) assert.equal(auth.status, 201, JSON.stringify(auth.body));
  codeTouched = true;
  fixture.attempts.push(...auths.map(auth => auth.body.attemptId));
  assert.equal((await call("/api/qr/order-auth", { method: "POST", cookie: cookies[0], body: { requestId: requestIds[0], cart } })).body.duplicate, true);
  const current = await one("SELECT code FROM tv_qr_auth_code_state WHERE state_id=1");
  const verified = await Promise.all(cookies.map((cookie, index) => call("/api/qr/order-auth/verify", {
    method: "POST", cookie, body: { attemptId: auths[index].body.attemptId, code: current.code } })));
  for (const result of verified) assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal((await order(cookies[0], requestIds[0], [{ ...cart[0], qty: 2 }], auths[0].body.attemptId)).body.code,
    "AUTH_REQUIRED", "Changing the cart invalidates the proof");
  assert.equal((await order(cookies[1], requestIds[0], cart, auths[0].body.attemptId)).body.code,
    "AUTH_REQUIRED", "Another QR session cannot reuse the proof");
  const raced = await Promise.all(cookies.map((cookie, index) => order(cookie, requestIds[index], cart, auths[index].body.attemptId)));
  const winner = raced.findIndex(result => result.status === 201);
  assert.ok(winner >= 0, JSON.stringify(raced));
  const loser = 1 - winner;
  assert.equal(raced[loser].body.code, "OTHER_REPRESENTATIVE", JSON.stringify(raced));
  fixture.qrOrders.push(Number(raced[winner].body.qrOrderId));
  assert.equal((await one("SELECT state FROM qr_order_auth_attempts WHERE attempt_id=?", [auths[winner].body.attemptId])).state, "CONSUMED");
  assert.equal((await one("SELECT state FROM qr_order_auth_attempts WHERE attempt_id=?", [auths[loser].body.attemptId])).state, "VERIFIED");
  assert.equal((await one("SELECT state FROM qr_table_order_claims WHERE table_id=?", [fixture.table])).state, "PENDING");
  assert.equal((await order(cookies[winner], requestIds[winner], cart, auths[winner].body.attemptId)).body.duplicate, true);
  assert.equal((await order(cookies[winner], randomUUID(), cart)).body.code, "APPROVAL_PENDING");
  assert.equal((await order(cookies[loser], randomUUID(), cart)).body.code, "OTHER_REPRESENTATIVE");
  assert.equal((await call("/api/qr/order-auth", { cookie: cookies[winner] })).body.representativeState, "OWN_PENDING");
  assert.equal((await call("/api/qr/order-auth", { cookie: cookies[loser] })).body.representativeState, "OTHER_PENDING");
  const trustToken = randomBytes(32).toString("base64url");
  const staffToken = randomBytes(32).toString("base64url");
  fixture.trust = Number((await db.execute("INSERT INTO program_trust_tokens (program,token_hash,enrolled_by_staff_id) VALUES ('POS',?,?)",
    [createHash("sha256").update(trustToken).digest("hex"), staff.staff_id]))[0].insertId);
  fixture.staffSession = Number((await db.execute("INSERT INTO staff_sessions (staff_id,trust_token_id,session_token_hash,session_type,status) VALUES (?,?,?,'POS','ACTIVE')",
    [staff.staff_id, fixture.trust, createHash("sha256").update(staffToken).digest("hex")]))[0].insertId);
  const staffCookie = `tdk_pos_session=${staffToken}; tdk_pos_trust_${fixture.trust}=${trustToken}`;
  const hosTrustToken = randomBytes(32).toString("base64url");
  const hosSessionToken = randomBytes(32).toString("base64url");
  fixture.hosTrust = Number((await db.execute("INSERT INTO program_trust_tokens (program,token_hash,enrolled_by_staff_id) VALUES ('HOS',?,?)",
    [createHash("sha256").update(hosTrustToken).digest("hex"), staff.staff_id]))[0].insertId);
  fixture.hosStaffSession = Number((await db.execute("INSERT INTO staff_sessions (staff_id,trust_token_id,session_token_hash,session_type,status) VALUES (?,?,?,'HOS','ACTIVE')",
    [staff.staff_id, fixture.hosTrust, createHash("sha256").update(hosSessionToken).digest("hex")]))[0].insertId);
  const hosCookie = `tdk_hos_session=${hosSessionToken}; tdk_hos_trust_${fixture.hosTrust}=${hosTrustToken}`;
  const adminTrustToken = randomBytes(32).toString("base64url");
  const adminSessionToken = `admin.${randomBytes(32).toString("base64url")}`;
  fixture.adminTrust = Number((await db.execute("INSERT INTO program_trust_tokens (program,token_hash,enrolled_by_staff_id) VALUES ('ADM',?,?)",
    [createHash("sha256").update(adminTrustToken).digest("hex"), staff.staff_id]))[0].insertId);
  fixture.adminStaffSession = Number((await db.execute("INSERT INTO staff_sessions (staff_id,trust_token_id,session_token_hash,session_type,status) VALUES (?,?,?,'ADMIN','ACTIVE')",
    [staff.staff_id, fixture.adminTrust, createHash("sha256").update(adminSessionToken).digest("hex")]))[0].insertId);
  const adminCookie = `tdk_admin_session=${adminSessionToken}; tdk_adm_trust_${fixture.adminTrust}=${adminTrustToken}`;
  const initialRejection = await call("/api/pos/qr-table-orders", { method: "PATCH", cookie: staffCookie,
    body: { qrOrderId: fixture.qrOrders[0], action: "REJECT" } });
  assert.equal(initialRejection.status, 200, JSON.stringify(initialRejection.body));
  assert.equal(await one("SELECT state FROM qr_table_order_claims WHERE table_id=?", [fixture.table]), null,
    "Initial rejection must release pending representative claim");
  assert.equal((await order(cookies[winner], randomUUID(), cart, auths[winner].body.attemptId)).body.code,
    "AUTH_REQUIRED", "Consumed proof must not authorize a new request");
  await db.execute("UPDATE table_sessions SET status='CLOSED' WHERE session_id=?", [fixture.visit]);
  fixture.interimVisit = Number((await db.execute("INSERT INTO table_sessions (table_id,status,session_kind,opened_by_staff_id) VALUES (?,'OPEN','DINE_IN',?)",
    [fixture.table, staff.staff_id]))[0].insertId);
  const staleProof = await order(cookies[loser], requestIds[loser], cart, auths[loser].body.attemptId);
  assert.equal(staleProof.body.code, "AUTH_REQUIRED", JSON.stringify(staleProof.body));
  await db.execute("UPDATE table_sessions SET status='CLOSED' WHERE session_id=?", [fixture.interimVisit]);
  await db.execute("UPDATE table_sessions SET status='OPEN' WHERE session_id=?", [fixture.visit]);
  const retried = await order(cookies[loser], requestIds[loser], cart, auths[loser].body.attemptId);
  assert.equal(retried.status, 201, JSON.stringify(retried.body));
  fixture.qrOrders.push(Number(retried.body.qrOrderId));
  const representative = loser;
  const nonRepresentative = winner;
  const approval = await call("/api/pos/qr-table-orders", { method: "PATCH", cookie: staffCookie,
    body: { qrOrderId: fixture.qrOrders[1], action: "ACCEPT" } });
  assert.equal(approval.status, 200, JSON.stringify(approval.body));
  if (approval.body.acceptedOrderId) fixture.orders.push(Number(approval.body.acceptedOrderId));
  assert.equal((await call("/api/pos/qr-table-orders", { method: "PATCH", cookie: staffCookie,
    body: { qrOrderId: fixture.qrOrders[1], action: "ACCEPT" } })).status, 409,
  "Repeated approval must not create a second POS order");
  const claim = await one("SELECT state,table_session_id FROM qr_table_order_claims WHERE table_id=?", [fixture.table]);
  assert.equal(claim.state, "CONFIRMED");
  assert.equal(Number(claim.table_session_id), fixture.visit);
  assert.equal((await call("/api/qr/order-auth", { cookie: cookies[representative] })).body.representativeState, "OWN_CONFIRMED");
  assert.equal((await call("/api/qr/order-auth", { cookie: cookies[nonRepresentative] })).body.representativeState, "OTHER_CONFIRMED");
  const staffOrder = await call(`/api/table-sessions/${fixture.visit}/orders`, { method: "POST", cookie: staffCookie,
    body: { items: [{ menuId: Number(menu.menuId), qty: 1, options: [] }] } });
  assert.equal(staffOrder.status, 200, JSON.stringify(staffOrder.body));
  const staffOrderRow = await one("SELECT order_id FROM orders WHERE session_id=? AND order_id<>? ORDER BY order_id DESC LIMIT 1",
    [fixture.visit, fixture.orders[0]]);
  assert.ok(staffOrderRow);
  fixture.orders.push(Number(staffOrderRow.order_id));
  const followup = await order(cookies[representative], randomUUID(), cart);
  assert.equal(followup.status, 201, JSON.stringify(followup.body));
  fixture.qrOrders.push(Number(followup.body.qrOrderId));
  assert.equal((await order(cookies[nonRepresentative], randomUUID(), cart)).body.code, "OTHER_REPRESENTATIVE");
  const representativeOrders = await call("/api/qr/table-orders", { cookie: cookies[representative] });
  assert.equal(representativeOrders.body.canViewOrders, true);
  assert.equal(Number(representativeOrders.body.confirmedSummary.grossAmount), Number(menu.price) * 2);
  const nonRepresentativeOrders = await call("/api/qr/table-orders", { cookie: cookies[nonRepresentative] });
  assert.equal(nonRepresentativeOrders.body.canViewOrders, false);
  assert.equal(nonRepresentativeOrders.body.canViewCurrentVisitOrders, true,
    "A non-representative must see current-visit orders without gaining ordering rights");
  assert.equal(nonRepresentativeOrders.body.posOrders.length, 2);
  assert.equal(Number(nonRepresentativeOrders.body.confirmedSummary.grossAmount), Number(menu.price) * 2);
  const blockedComplete = await call(`/api/table-sessions/${fixture.visit}`, { method: "PATCH", cookie: staffCookie });
  assert.equal(blockedComplete.status, 409, "Pending QR order must block COMPLETE");
  assert.equal((await one("SELECT status FROM table_sessions WHERE session_id=?", [fixture.visit])).status, "OPEN");
  const acceptedFollowup = await call("/api/pos/qr-table-orders", { method: "PATCH", cookie: staffCookie,
    body: { qrOrderId: fixture.qrOrders[2], action: "ACCEPT" } });
  assert.equal(acceptedFollowup.status, 200, JSON.stringify(acceptedFollowup.body));
  fixture.orders.push(Number(acceptedFollowup.body.acceptedOrderId));
  const afterFollowup = await call("/api/qr/table-orders", { cookie: cookies[representative] });
  assert.equal(Number(afterFollowup.body.confirmedSummary.grossAmount), Number(menu.price) * 3);
  assert.equal(afterFollowup.body.orders.length, 2);
  assert.equal(afterFollowup.body.posOrders.length, 3);
  assert.deepEqual(afterFollowup.body.posOrders.map(row => Number(row.orderId)).reverse(), fixture.orders.slice(0, 3));
  const pendingToReject = await order(cookies[representative], randomUUID(), cart);
  assert.equal(pendingToReject.status, 201, JSON.stringify(pendingToReject.body));
  fixture.qrOrders.push(Number(pendingToReject.body.qrOrderId));
  const rejectedFollowup = await call("/api/pos/qr-table-orders", { method: "PATCH", cookie: staffCookie,
    body: { qrOrderId: fixture.qrOrders[3], action: "REJECT" } });
  assert.equal(rejectedFollowup.status, 200, JSON.stringify(rejectedFollowup.body));
  assert.equal((await one("SELECT state FROM qr_table_order_claims WHERE table_id=?", [fixture.table])).state, "CONFIRMED");
  const unusedAttempt = randomUUID();
  await db.execute(`INSERT INTO qr_order_auth_attempts
    (attempt_id,qr_session_id,table_id,table_session_id_at_auth,session_snapshot_recorded,client_request_id,
      issuance_id,code,cart_fingerprint,state,expires_at)
    VALUES (?,?,?,?,1,? ,?,'00',?,'VERIFIED',DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 120 SECOND))`,
  [unusedAttempt, fixture.customers[nonRepresentative], fixture.table, fixture.visit, randomUUID(), randomUUID(),
    createHash("sha256").update("unused TV-7D test proof").digest("hex")]);
  const complete = await call(`/api/table-sessions/${fixture.visit}`, { method: "PATCH", cookie: staffCookie });
  assert.equal(complete.status, 200, JSON.stringify(complete.body));
  assert.equal((await one("SELECT status FROM table_sessions WHERE session_id=?", [fixture.visit])).status, "CLOSED");
  assert.equal(await one("SELECT state FROM qr_table_order_claims WHERE table_id=?", [fixture.table]), null);
  assert.equal((await one("SELECT state FROM qr_order_auth_attempts WHERE attempt_id=?", [unusedAttempt])).state, "BLOCKED");
  assert.equal((await one("SELECT COUNT(*) n FROM qr_sessions WHERE table_id=? AND status='ACTIVE'", [fixture.table])).n, 0);
  assert.ok((await order(cookies[representative], randomUUID(), cart)).status >= 400);
  const oldVisit = await call("/api/qr/table-orders", { cookie: cookies[representative] });
  assert.ok(oldVisit.status === 401 || oldVisit.body?.canViewOrders === false, "Old visit may not expose order history");
  fixture.visitB = Number((await db.execute("INSERT INTO table_sessions (table_id,status,session_kind,opened_by_staff_id) VALUES (?,'OPEN','DINE_IN',?)",
    [fixture.table, staff.staff_id]))[0].insertId);
  assert.equal((await call(`/api/table-sessions/${fixture.visit}`, { method: "PATCH", cookie: staffCookie })).status, 409);
  assert.equal((await one("SELECT status FROM table_sessions WHERE session_id=?", [fixture.visitB])).status, "OPEN");
  const newVisitScan = await call(`/tdkqrs/${identifier}`);
  const newCookie = cookieFrom(newVisitScan.response);
  const newHash = createHash("sha256").update(decodeURIComponent(newCookie.split("=")[1])).digest("hex");
  fixture.customers.push(Number((await one("SELECT qr_session_id FROM qr_sessions WHERE token_hash=?", [newHash])).qr_session_id));
  const newVisitOrders = await call("/api/qr/table-orders", { cookie: newCookie });
  assert.equal(newVisitOrders.body?.canViewOrders, false);
  assert.equal(newVisitOrders.body?.canViewCurrentVisitOrders, true);
  assert.equal(newVisitOrders.body?.posOrders?.length, 0);
  const newRequestId = randomUUID();
  const newAuth = await call("/api/qr/order-auth", { method: "POST", cookie: newCookie, body: { requestId: newRequestId, cart } });
  assert.equal(newAuth.status, 201, JSON.stringify(newAuth.body));
  const newCode = await one("SELECT code FROM tv_qr_auth_code_state WHERE state_id=1");
  const [hosCode, tvCode] = await Promise.all([
    call("/api/hos/qr-auth-code", { cookie: hosCookie }),
    call("/api/tdktv/qr-auth-code", { cookie: adminCookie }),
  ]);
  assert.equal(hosCode.status, 200, JSON.stringify(hosCode.body));
  assert.equal(tvCode.status, 200, JSON.stringify(tvCode.body));
  assert.equal(hosCode.body.code, newCode.code);
  assert.equal(tvCode.body.code, newCode.code);
  assert.equal(hosCode.body.issuanceId, tvCode.body.issuanceId);
  assert.equal(hosCode.body.expiresAtMs, tvCode.body.expiresAtMs,
    "Status reads must not extend the display deadline");
  assert.equal((await call("/api/qr/order-auth/verify", { method: "POST", cookie: newCookie,
    body: { attemptId: newAuth.body.attemptId, code: newCode.code } })).status, 200);
  const newOrder = await order(newCookie, newRequestId, cart, newAuth.body.attemptId);
  assert.equal(newOrder.status, 201, JSON.stringify(newOrder.body));
  fixture.qrOrders.push(Number(newOrder.body.qrOrderId));
  const newApproval = await call("/api/pos/qr-table-orders", { method: "PATCH", cookie: staffCookie,
    body: { qrOrderId: newOrder.body.qrOrderId, action: "ACCEPT" } });
  assert.equal(newApproval.status, 200, JSON.stringify(newApproval.body));
  fixture.orders.push(Number(newApproval.body.acceptedOrderId));
  assert.equal(Number((await one("SELECT table_session_id FROM qr_table_order_claims WHERE table_id=?", [fixture.table])).table_session_id), fixture.visitB);
  const visitBOrders = await call("/api/qr/table-orders", { cookie: newCookie });
  assert.equal(visitBOrders.body.orders.length, 1);
  assert.equal(visitBOrders.body.posOrders.length, 1);
  assert.equal(Number(visitBOrders.body.confirmedSummary.grossAmount), Number(menu.price));
  assert.equal(Number((await one("SELECT COUNT(*) n FROM qr_orders WHERE qr_order_id IN (?,?,?)", fixture.qrOrders.slice(0, 3))).n), 3,
    "Old QR order records must remain until isolated fixture cleanup");
  const checkoutState = await call(`/api/checkouts?tableId=${fixture.table}`, { cookie: staffCookie });
  assert.equal(checkoutState.status, 200, JSON.stringify(checkoutState.body));
  assert.equal(checkoutState.body.total, Number(menu.price));
  const paid = await call("/api/checkouts", { method: "POST", cookie: staffCookie,
    body: { tableId: fixture.table, action: "PAY", methodCode: "CASH", amount: Number(menu.price),
      expectedBillVersion: checkoutState.body.billVersion } });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  fixture.checkouts.push(...paid.body.completedCheckoutIds.map(Number));
  assert.equal((await one("SELECT state FROM qr_table_order_claims WHERE table_id=?", [fixture.table])).state, "CONFIRMED",
    "Payment alone must retain the representative");
  assert.equal((await one("SELECT status FROM table_sessions WHERE session_id=?", [fixture.visitB])).status, "OPEN");
  const [racingOrder, racingComplete] = await Promise.all([
    order(newCookie, randomUUID(), cart),
    call("/api/checkouts", { method: "POST", cookie: staffCookie,
      body: { tableId: fixture.table, action: "COMPLETE", expectedBillVersion: checkoutState.body.billVersion } }),
  ]);
  let checkoutComplete = racingComplete;
  if (racingOrder.status === 201) {
    fixture.qrOrders.push(Number(racingOrder.body.qrOrderId));
    assert.equal(racingComplete.status, 409, JSON.stringify(racingComplete.body));
    const raceRejection = await call("/api/pos/qr-table-orders", { method: "PATCH", cookie: staffCookie,
      body: { qrOrderId: racingOrder.body.qrOrderId, action: "REJECT" } });
    assert.equal(raceRejection.status, 200, JSON.stringify(raceRejection.body));
    checkoutComplete = await call("/api/checkouts", { method: "POST", cookie: staffCookie,
      body: { tableId: fixture.table, action: "COMPLETE", expectedBillVersion: checkoutState.body.billVersion } });
  } else {
    assert.equal(racingComplete.status, 200, JSON.stringify(racingComplete.body));
    assert.ok(racingOrder.status === 401 || racingOrder.status === 409, JSON.stringify(racingOrder.body));
  }
  assert.equal(checkoutComplete.status, 200, JSON.stringify(checkoutComplete.body));
  assert.equal((await one("SELECT status FROM table_sessions WHERE session_id=?", [fixture.visitB])).status, "CLOSED");
  assert.equal(await one("SELECT state FROM qr_table_order_claims WHERE table_id=?", [fixture.table]), null);
  assert.equal((await one("SELECT status FROM orders WHERE order_id=?", [newApproval.body.acceptedOrderId])).status, "COMPLETED");
  assert.equal((await call("/api/checkouts", { method: "POST", cookie: staffCookie,
    body: { tableId: fixture.table, action: "COMPLETE", expectedBillVersion: checkoutState.body.billVersion } })).status, 404);
  fixture.visitC = Number((await db.execute("INSERT INTO table_sessions (table_id,status,session_kind,opened_by_staff_id) VALUES (?,'OPEN','DINE_IN',?)",
    [fixture.table, staff.staff_id]))[0].insertId);
  const visitCScan = await call(`/tdkqrs/${identifier}`);
  const visitCCookie = cookieFrom(visitCScan.response);
  const visitCHash = createHash("sha256").update(decodeURIComponent(visitCCookie.split("=")[1])).digest("hex");
  fixture.customers.push(Number((await one("SELECT qr_session_id FROM qr_sessions WHERE token_hash=?", [visitCHash])).qr_session_id));
  const visitCRequestId = randomUUID();
  const visitCAuth = await call("/api/qr/order-auth", { method: "POST", cookie: visitCCookie,
    body: { requestId: visitCRequestId, cart } });
  assert.equal(visitCAuth.status, 201, JSON.stringify(visitCAuth.body));
  const visitCCode = await one("SELECT code FROM tv_qr_auth_code_state WHERE state_id=1");
  assert.equal((await call("/api/qr/order-auth/verify", { method: "POST", cookie: visitCCookie,
    body: { attemptId: visitCAuth.body.attemptId, code: visitCCode.code } })).status, 200);
  const visitCOrder = await order(visitCCookie, visitCRequestId, cart, visitCAuth.body.attemptId);
  assert.equal(visitCOrder.status, 201, JSON.stringify(visitCOrder.body));
  fixture.qrOrders.push(Number(visitCOrder.body.qrOrderId));
  const [approvalRace, completeRace] = await Promise.all([
    call("/api/pos/qr-table-orders", { method: "PATCH", cookie: staffCookie,
      body: { qrOrderId: visitCOrder.body.qrOrderId, action: "ACCEPT" } }),
    call(`/api/table-sessions/${fixture.visitC}`, { method: "PATCH", cookie: staffCookie }),
  ]);
  assert.equal(approvalRace.status, 200, JSON.stringify(approvalRace.body));
  fixture.orders.push(Number(approvalRace.body.acceptedOrderId));
  assert.ok([200, 409].includes(completeRace.status), JSON.stringify(completeRace.body));
  if (completeRace.status === 409) {
    assert.equal((await one("SELECT status FROM table_sessions WHERE session_id=?", [fixture.visitC])).status, "OPEN");
    const retriedComplete = await call(`/api/table-sessions/${fixture.visitC}`, { method: "PATCH", cookie: staffCookie });
    assert.equal(retriedComplete.status, 200, JSON.stringify(retriedComplete.body));
  }
  assert.equal((await one("SELECT status FROM table_sessions WHERE session_id=?", [fixture.visitC])).status, "CLOSED");
  assert.equal(await one("SELECT state FROM qr_table_order_claims WHERE table_id=?", [fixture.table]), null);
  assert.equal((await one("SELECT status FROM qr_orders WHERE qr_order_id=?", [visitCOrder.body.qrOrderId])).status, "ACCEPTED");
  console.log("TV-7D HTTP integration PASS: both COMPLETE paths, pending protection, approval/COMPLETE and order/COMPLETE races, payment separation, replay isolation, fresh representative and round totals");
} catch (error) {
  console.error("TV-7D HTTP assertion failed:", error);
  throw error;
} finally {
  try { await cleanup(); console.log("TV-7D isolated fixture cleanup PASS"); } finally { await db.end(); }
}
