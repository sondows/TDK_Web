/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS test script */
// TEST-only HTTP smoke test. Creates empty takeouts and removes only its own fixtures.
const assert = require("node:assert/strict");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local"), quiet: true });
if (process.env.DB_NAME !== "TDK_POS_TEST") throw new Error("TDK_POS_TEST only");
const mysql = require("mysql2/promise");

const baseUrl = process.env.TAKEOUT_TEST_BASE_URL || "http://127.0.0.1:3105";
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const keys = Array.from({ length: 9 }, () => randomUUID());

async function request(pathname, method = "GET", body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { Cookie: `tdk_pos_session=${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}

(async () => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  let staffSessionId;
  try {
    const [staff] = await connection.query("SELECT staff_id FROM staff WHERE staff_code = '000' AND is_active = 1 LIMIT 1");
    assert(staff.length, "active shared staff required");
    const [login] = await connection.query("INSERT INTO staff_sessions (staff_id, session_token_hash, status) VALUES (?, ?, 'ACTIVE')", [staff[0].staff_id, tokenHash]);
    staffSessionId = login.insertId;

    assert.equal((await request("/api/pos/takeouts")).status, 200);
    const first = await request("/api/pos/takeouts", "POST", { kind: "TAKEOUT_WALK_IN", requestKey: keys[0] });
    assert.equal(first.status, 201, JSON.stringify(first.data));
    const duplicateRequest = await request("/api/pos/takeouts", "POST", { kind: "TAKEOUT_WALK_IN", requestKey: keys[0] });
    assert.equal(duplicateRequest.status, 200, JSON.stringify(duplicateRequest.data));
    assert.equal(duplicateRequest.data.session.sessionId, first.data.session.sessionId);
    const second = await request("/api/pos/takeouts", "POST", { kind: "TAKEOUT_WALK_IN", requestKey: keys[1], pickupAt: "2026-10-16 12:30:00", pickupPhone: "5475" });
    assert.equal(second.status, 201, JSON.stringify(second.data));
    assert.equal(second.data.session.pickupPhone, "5475");
    assert.equal(second.data.session.pickupAt, "2026-10-16 12:30:00");
    const phone = await request("/api/pos/takeouts", "POST", { kind: "TAKEOUT_PHONE", requestKey: keys[2], pickupPhone: "5475" });
    assert.equal(phone.status, 201, JSON.stringify(phone.data));
    assert.equal(phone.data.session.pickupPhone, "5475");
    const concurrent = await Promise.all(keys.slice(3).map(requestKey => request("/api/pos/takeouts", "POST", { kind: "TAKEOUT_PHONE", requestKey })));
    concurrent.forEach(item => assert.equal(item.status, 201, JSON.stringify(item.data)));
    assert.equal(new Set(concurrent.map(item => item.data.session.sessionId)).size, concurrent.length);
    assert.equal(new Set([phone, ...concurrent].map(item => item.data.session.displayName)).size, concurrent.length + 1);
    assert.notEqual(first.data.session.sessionId, second.data.session.sessionId);
    assert.notEqual(first.data.session.displayName, second.data.session.displayName);
    assert.match(first.data.session.displayName, /^포장\d{4}(?:-\d+)?$/);
    assert.match(phone.data.session.displayName, /^포장\d{4}(?:-\d+)?$/);

    const open = await request("/api/pos/takeouts");
    assert.equal(open.status, 200);
    for (const item of [first, second, phone, ...concurrent])
      assert(open.data.sessions.some(session => session.sessionId === item.data.session.sessionId));
    for (const item of [first, second, phone, ...concurrent]) {
      const cancelled = await request("/api/pos/takeouts", "DELETE", { sessionId: item.data.session.sessionId });
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
    }
    const after = await request("/api/pos/takeouts");
    for (const item of [first, second, phone, ...concurrent])
      assert(!after.data.sessions.some(session => session.sessionId === item.data.session.sessionId));
    const repeatedCancel = await request("/api/pos/takeouts", "DELETE", { sessionId: first.data.session.sessionId });
    assert.equal(repeatedCancel.status, 409);
    console.log(JSON.stringify({ database: "TDK_POS_TEST", result: "PASS", created: 9, idempotent: true, concurrentPhoneCreates: 6, distinctLabels: true, cancelled: 9, hiddenAfterCancel: true }));
  } finally {
    try {
      const [fixtures] = await connection.query("SELECT session_id FROM table_sessions WHERE create_request_key IN (?)", [keys]);
      for (const fixture of fixtures) {
        const [linked] = await connection.query("SELECT EXISTS(SELECT 1 FROM orders WHERE session_id = ?) AS has_orders, EXISTS(SELECT 1 FROM payment_session_allocations WHERE session_id = ?) AS has_payments, EXISTS(SELECT 1 FROM table_session_discounts WHERE session_id = ?) AS has_discounts", [fixture.session_id, fixture.session_id, fixture.session_id]);
        if (linked[0].has_orders || linked[0].has_payments || linked[0].has_discounts) throw new Error(`fixture ${fixture.session_id} has linked data; cleanup stopped`);
        await connection.query("DELETE FROM table_sessions WHERE session_id = ?", [fixture.session_id]);
      }
      if (staffSessionId) await connection.query("DELETE FROM staff_sessions WHERE staff_session_id = ? AND session_token_hash = ?", [staffSessionId, tokenHash]);
    } finally { await connection.end(); }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
