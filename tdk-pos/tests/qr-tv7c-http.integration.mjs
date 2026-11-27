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
const fixture = { table: null, code: null, visit: null, interimVisit: null, visitB: null, customers: [], attempts: [], qrOrders: [], orders: [],
  trust: null, staffSession: null };
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
      for (const id of new Set(fixture.orders)) {
        await db.execute("DELETE FROM order_item_options WHERE order_item_id IN (SELECT order_item_id FROM order_items WHERE order_id=?)", [id]);
        await db.execute("DELETE FROM order_items WHERE order_id=?", [id]);
        await db.execute("DELETE FROM orders WHERE order_id=?", [id]);
      }
      for (const id of fixture.customers) await db.execute("DELETE FROM qr_sessions WHERE qr_session_id=?", [id]);
      if (fixture.visitB !== null) await db.execute("DELETE FROM table_sessions WHERE session_id=?", [fixture.visitB]);
      if (fixture.interimVisit !== null) await db.execute("DELETE FROM table_sessions WHERE session_id=?", [fixture.interimVisit]);
      if (fixture.visit !== null) await db.execute("DELETE FROM table_sessions WHERE session_id=?", [fixture.visit]);
      if (fixture.staffSession !== null) await db.execute("DELETE FROM staff_sessions WHERE staff_session_id=?", [fixture.staffSession]);
      if (fixture.trust !== null) await db.execute("DELETE FROM program_trust_tokens WHERE token_id=?", [fixture.trust]);
      if (fixture.code !== null) {
        await db.execute("DELETE FROM qr_table_links WHERE qr_code_id=?", [fixture.code]);
        await db.execute("DELETE FROM audit_logs WHERE entity_type='QR_CODE' AND entity_id=?", [fixture.code]);
        await db.execute("DELETE FROM qr_codes WHERE qr_code_id=? AND identifier=?", [fixture.code, identifier]);
      }
      await db.execute("DELETE FROM dining_tables WHERE table_id=? AND table_no=?", [fixture.table, `ZZ7C${tag}`]);
      await db.commit();
    } catch (error) { await db.rollback(); throw error; }
  }
  if (codeTouched) {
    await db.execute(`UPDATE tv_qr_auth_code_state SET issuance_id=?,code=?,issued_at=?,last_requested_at=?,
      expires_at=?,state_version=?,updated_at=? WHERE state_id=1`, [initialCode.issuance_id, initialCode.code,
      initialCode.issued_at, initialCode.last_requested_at, initialCode.expires_at, initialCode.state_version,
      initialCode.updated_at]);
  }
  assert.equal(Number((await one("SELECT COUNT(*) n FROM dining_tables WHERE table_no=?", [`ZZ7C${tag}`])).n), 0);
  assert.equal(Number((await one("SELECT COUNT(*) n FROM qr_order_auth_attempts WHERE table_id=?", [fixture.table])).n), 0);
  assert.equal(Number((await one("SELECT COUNT(*) n FROM qr_table_order_claims WHERE table_id=?", [fixture.table])).n), 0);
}

try {
  assert.equal((await one("SELECT DATABASE() db")).db, "TDK_POS_TEST");
  assert.equal((await call("/api/db-test")).body?.result?.[0]?.database_name, "TDK_POS_TEST");
  const staff = await one("SELECT staff_id FROM staff WHERE is_active=1 AND pos_enabled=1 AND employee_pin_hash IS NOT NULL AND staff_code<>'000' ORDER BY staff_id LIMIT 1");
  assert.ok(staff, "Active POS test staff required");
  initialCode = await one("SELECT * FROM tv_qr_auth_code_state WHERE state_id=1");
  assert.ok(initialCode);
  assert.equal(initialCode.issuance_id, null, "Refusing to disturb existing TV code");
  assert.equal(initialCode.code, null, "Refusing to disturb existing TV code");
  assert.equal(Number(initialCode.state_version), 0, "Refusing to disturb existing TV code history");
  assert.equal(Number((await one("SELECT is_active FROM tv_business_notice WHERE notice_id=1")).is_active), 0);
  // Compile each route before starting the ten-second verification window.
  await Promise.all([call("/api/qr/order-auth"), call("/api/qr/order-auth/verify", { method: "POST", body: {} }),
    call("/api/qr/table-orders"), call("/api/pos/qr-table-orders", { method: "PATCH", body: {} })]);
  fixture.table = Number((await db.execute("INSERT INTO dining_tables (table_no,capacity,is_active) VALUES (?,8,1)", [`ZZ7C${tag}`]))[0].insertId);
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
  const wrongCode = String((Number(current.code) + 1) % 100).padStart(2, "0");
  const mismatch = await call("/api/qr/order-auth/verify", { method: "POST", cookie: cookies[0],
    body: { attemptId: auths[0].body.attemptId, code: wrongCode } });
  assert.equal(mismatch.status, 422, JSON.stringify(mismatch.body));
  assert.equal(mismatch.body.code, "CODE_MISMATCH");
  const expired = await call("/api/qr/order-auth", { method: "POST", cookie: cookies[0],
    body: { requestId: randomUUID(), cart } });
  assert.equal(expired.status, 201, JSON.stringify(expired.body));
  fixture.attempts.push(expired.body.attemptId);
  await db.execute("UPDATE qr_order_auth_attempts SET expires_at=DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE attempt_id=? AND table_id=?",
    [expired.body.attemptId, fixture.table]);
  const expiredVerification = await call("/api/qr/order-auth/verify", { method: "POST", cookie: cookies[0],
    body: { attemptId: expired.body.attemptId, code: current.code } });
  assert.equal(expiredVerification.status, 409, JSON.stringify(expiredVerification.body));
  assert.equal(expiredVerification.body.code, "ATTEMPT_EXPIRED");
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
  const followup = await order(cookies[representative], randomUUID(), cart);
  assert.equal(followup.status, 201, JSON.stringify(followup.body));
  fixture.qrOrders.push(Number(followup.body.qrOrderId));
  assert.equal((await order(cookies[nonRepresentative], randomUUID(), cart)).body.code, "OTHER_REPRESENTATIVE");
  const representativeOrders = await call("/api/qr/table-orders", { cookie: cookies[representative] });
  assert.equal(representativeOrders.body.canViewOrders, true);
  assert.equal(Number(representativeOrders.body.confirmedSummary.grossAmount), Number(menu.price));
  assert.equal((await call("/api/qr/table-orders", { cookie: cookies[nonRepresentative] })).body.canViewOrders, false);
  const rejectedFollowup = await call("/api/pos/qr-table-orders", { method: "PATCH", cookie: staffCookie,
    body: { qrOrderId: fixture.qrOrders[2], action: "REJECT" } });
  assert.equal(rejectedFollowup.status, 200, JSON.stringify(rejectedFollowup.body));
  assert.equal((await one("SELECT state FROM qr_table_order_claims WHERE table_id=?", [fixture.table])).state, "CONFIRMED");
  await db.execute("UPDATE table_sessions SET status='CLOSED' WHERE session_id=?", [fixture.visit]);
  const oldVisit = await call("/api/qr/table-orders", { cookie: cookies[representative] });
  assert.ok(oldVisit.status === 401 || oldVisit.body?.canViewOrders === false, "Old visit may not expose order history");
  fixture.visitB = Number((await db.execute("INSERT INTO table_sessions (table_id,status,session_kind,opened_by_staff_id) VALUES (?,'OPEN','DINE_IN',?)",
    [fixture.table, staff.staff_id]))[0].insertId);
  const newVisitScan = await call(`/tdkqrs/${identifier}`);
  const newCookie = cookieFrom(newVisitScan.response);
  const newHash = createHash("sha256").update(decodeURIComponent(newCookie.split("=")[1])).digest("hex");
  fixture.customers.push(Number((await one("SELECT qr_session_id FROM qr_sessions WHERE token_hash=?", [newHash])).qr_session_id));
  const newVisitOrders = await call("/api/qr/table-orders", { cookie: newCookie });
  assert.equal(newVisitOrders.body?.canViewOrders, false);
  assert.equal(newVisitOrders.body?.posOrders?.length, 0);
  console.log("TV-7C HTTP integration PASS: concurrent claim, initial rejection and retry, stale visit proof denied, approval, follow-up, rejection retention, new-visit isolation");
} catch (error) {
  console.error("TV-7C HTTP assertion failed:", error);
  throw error;
} finally {
  try { await cleanup(); console.log("TV-7C isolated fixture cleanup PASS"); } finally { await db.end(); }
}
