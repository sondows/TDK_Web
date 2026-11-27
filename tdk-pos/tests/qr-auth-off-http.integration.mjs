import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local", quiet: true });
assert.equal(process.env.DB_NAME, "TDK_POS_TEST", "Development DB only");
const base = new URL(process.env.QR_TEST_HTTP_BASE_URL ?? "http://127.0.0.1:3000");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: "TDK_POS_TEST" });
const tag = randomBytes(7).toString("hex");
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const identifier = Array.from(randomBytes(16), byte => alphabet[byte % alphabet.length]).join("");
const fixture = { table: null, code: null, visit: null, trust: null, staffSession: null, hosTrust: null, hosStaffSession: null };
const one = async (sql, args = []) => (await db.execute(sql, args))[0][0] ?? null;
const call = async (path, { method = "GET", cookie, body } = {}) => {
  const response = await fetch(new URL(path, base), { method, cache: "no-store", redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { origin: base.origin, "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: response.headers.get("content-type")?.includes("application/json")
    ? await response.json() : null, response };
};
const qrCookie = response => {
  const token = response.headers.get("set-cookie")?.match(/tdkon_qr_session=([^;,]+)/)?.[1];
  assert.ok(token, "QR scan must issue a customer cookie");
  return `tdkon_qr_session=${token}`;
};

async function cleanup() {
  if (fixture.table === null) return;
  await db.beginTransaction();
  try {
    const [qrOrders] = await db.execute(`SELECT o.qr_order_id,o.accepted_order_id FROM qr_orders o
      JOIN qr_sessions s ON s.qr_session_id=o.qr_session_id WHERE s.table_id=?`, [fixture.table]);
    for (const order of qrOrders) {
      await db.execute("DELETE FROM qr_order_item_options WHERE qr_order_item_id IN (SELECT qr_order_item_id FROM qr_order_items WHERE qr_order_id=?)", [order.qr_order_id]);
      await db.execute("DELETE FROM qr_order_items WHERE qr_order_id=?", [order.qr_order_id]);
      await db.execute("DELETE FROM qr_orders WHERE qr_order_id=?", [order.qr_order_id]);
      if (order.accepted_order_id) {
        await db.execute("DELETE FROM order_item_options WHERE order_item_id IN (SELECT order_item_id FROM order_items WHERE order_id=?)", [order.accepted_order_id]);
        await db.execute("DELETE FROM order_items WHERE order_id=?", [order.accepted_order_id]);
        await db.execute("DELETE FROM orders WHERE order_id=?", [order.accepted_order_id]);
      }
    }
    await db.execute("DELETE FROM qr_order_auth_attempts WHERE table_id=?", [fixture.table]);
    await db.execute("DELETE FROM qr_table_order_claims WHERE table_id=?", [fixture.table]);
    await db.execute("DELETE FROM qr_sessions WHERE table_id=?", [fixture.table]);
    if (fixture.visit !== null) await db.execute("DELETE FROM table_sessions WHERE session_id=? AND table_id=?", [fixture.visit, fixture.table]);
    for (const id of [fixture.staffSession, fixture.hosStaffSession]) if (id !== null) await db.execute("DELETE FROM staff_sessions WHERE staff_session_id=?", [id]);
    for (const id of [fixture.trust, fixture.hosTrust]) if (id !== null) await db.execute("DELETE FROM program_trust_tokens WHERE token_id=?", [id]);
    if (fixture.code !== null) {
      await db.execute("DELETE FROM qr_table_links WHERE qr_code_id=? AND table_id=?", [fixture.code, fixture.table]);
      await db.execute("DELETE FROM audit_logs WHERE entity_type='QR_CODE' AND entity_id=?", [fixture.code]);
      await db.execute("DELETE FROM qr_codes WHERE qr_code_id=? AND identifier=?", [fixture.code, identifier]);
    }
    await db.execute("DELETE FROM dining_tables WHERE table_id=? AND table_no=?", [fixture.table, `ZZOFF${tag}`]);
    await db.commit();
  } catch (error) { await db.rollback(); throw error; }
  assert.equal(Number((await one("SELECT COUNT(*) n FROM dining_tables WHERE table_no=?", [`ZZOFF${tag}`])).n), 0);
}

try {
  assert.equal((await one("SELECT DATABASE() db")).db, "TDK_POS_TEST");
  assert.equal((await call("/api/db-test")).body?.result?.[0]?.database_name, "TDK_POS_TEST");
  assert.equal((await call("/api/qr/order-auth")).status, 404, "TV authentication must be OFF");
  const staff = await one(`SELECT staff_id FROM staff WHERE is_active=1 AND pos_enabled=1 AND hos_enabled=1
    AND employee_pin_hash IS NOT NULL AND staff_code<>'000' ORDER BY staff_id LIMIT 1`);
  assert.ok(staff, "Active POS/HOS test staff required");
  fixture.table = Number((await db.execute("INSERT INTO dining_tables (table_no,capacity,is_active) VALUES (?,8,1)", [`ZZOFF${tag}`]))[0].insertId);
  fixture.code = Number((await db.execute("INSERT INTO qr_codes (identifier,management_number,target_type,status,created_by_staff_id) VALUES (?,?,'TABLE_ORDER','IN_USE',?)",
    [identifier, `ZZOM${tag}`, staff.staff_id]))[0].insertId);
  await db.execute("INSERT INTO qr_table_links (qr_code_id,table_id,assigned_by_staff_id) VALUES (?,?,?)", [fixture.code, fixture.table, staff.staff_id]);
  fixture.visit = Number((await db.execute("INSERT INTO table_sessions (table_id,status,session_kind,opened_by_staff_id) VALUES (?,'OPEN','DINE_IN',?)", [fixture.table, staff.staff_id]))[0].insertId);
  const scans = await Promise.all([call(`/tdkqrs/${identifier}`), call(`/tdkqrs/${identifier}`)]);
  for (const scan of scans) assert.equal(new URL(scan.response.headers.get("location"), base).pathname, "/qrorder/order");
  const customers = scans.map(scan => qrCookie(scan.response));
  assert.notEqual(customers[0], customers[1]);
  const before = await call("/api/qr/table-orders", { cookie: customers[1] });
  assert.equal(before.status, 200);
  assert.equal(before.body.canViewCurrentVisitOrders, true);
  assert.equal(before.body.posOrders.length, 0);
  const catalog = (await call("/api/qr/menu-catalog")).body;
  const menu = catalog.menus.find(item => !catalog.modifierGroups.some(group =>
    Number(group.menuId) === Number(item.menuId) && (group.isRequired || Number(group.minSelect) > 0)));
  assert.ok(menu);
  const trustToken = randomBytes(32).toString("base64url");
  const posToken = randomBytes(32).toString("base64url");
  fixture.trust = Number((await db.execute("INSERT INTO program_trust_tokens (program,token_hash,enrolled_by_staff_id) VALUES ('POS',?,?)",
    [createHash("sha256").update(trustToken).digest("hex"), staff.staff_id]))[0].insertId);
  fixture.staffSession = Number((await db.execute("INSERT INTO staff_sessions (staff_id,trust_token_id,session_token_hash,session_type,status) VALUES (?,?,?,'POS','ACTIVE')",
    [staff.staff_id, fixture.trust, createHash("sha256").update(posToken).digest("hex")]))[0].insertId);
  const posCookie = `tdk_pos_session=${posToken}; tdk_pos_trust_${fixture.trust}=${trustToken}`;
  const hosTrustToken = randomBytes(32).toString("base64url");
  const hosToken = randomBytes(32).toString("base64url");
  fixture.hosTrust = Number((await db.execute("INSERT INTO program_trust_tokens (program,token_hash,enrolled_by_staff_id) VALUES ('HOS',?,?)",
    [createHash("sha256").update(hosTrustToken).digest("hex"), staff.staff_id]))[0].insertId);
  fixture.hosStaffSession = Number((await db.execute("INSERT INTO staff_sessions (staff_id,trust_token_id,session_token_hash,session_type,status) VALUES (?,?,?,'HOS','ACTIVE')",
    [staff.staff_id, fixture.hosTrust, createHash("sha256").update(hosToken).digest("hex")]))[0].insertId);
  const hosCookie = `tdk_hos_session=${hosToken}; tdk_hos_trust_${fixture.hosTrust}=${hosTrustToken}`;
  const submitted = await call("/api/qr/table-orders", { method: "POST", cookie: customers[0],
    body: { requestId: randomUUID(), cart: [{ menuId: Number(menu.menuId), qty: 1, options: [] }] } });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  const hosList = await call("/api/pos/qr-table-orders", { cookie: hosCookie });
  assert.equal(hosList.status, 200, JSON.stringify(hosList.body));
  assert.ok(hosList.body.orders.some(order => Number(order.qrOrderId) === Number(submitted.body.qrOrderId)));
  const approved = await call("/api/pos/qr-table-orders", { method: "PATCH", cookie: hosCookie,
    body: { qrOrderId: submitted.body.qrOrderId, action: "ACCEPT" } });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const otherHistory = await call("/api/qr/table-orders", { cookie: customers[1] });
  assert.equal(otherHistory.status, 200);
  assert.equal(otherHistory.body.canViewCurrentVisitOrders, true);
  assert.equal(otherHistory.body.posOrders.length, 1);
  assert.equal(Number(otherHistory.body.confirmedSummary.grossAmount), Number(menu.price));
  const complete = await call(`/api/table-sessions/${fixture.visit}`, { method: "PATCH", cookie: posCookie });
  assert.equal(complete.status, 200, JSON.stringify(complete.body));
  const oldHistory = await call("/api/qr/table-orders", { cookie: customers[1] });
  assert.ok(oldHistory.status === 401 || oldHistory.body?.posOrders?.length === 0,
    "A completed visit must not expose old orders");
  console.log("QR auth OFF HTTP integration PASS: no TV code, two customer scans, free current-visit view, HOS approval, COMPLETE isolation");
} finally {
  try { await cleanup(); console.log("QR auth OFF isolated fixture cleanup PASS"); } finally { await db.end(); }
}
