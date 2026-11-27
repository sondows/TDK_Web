import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local", quiet: true });
assert.equal(process.env.DB_NAME, "TDK_POS_TEST");
const base = new URL(process.env.QR_TEST_HTTP_BASE_URL ?? "http://localhost:3000");
assert.equal(base.protocol, "http:");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname));
const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: "TDK_POS_TEST" });
const tag = randomBytes(8).toString("hex");
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const identifier = Array.from(randomBytes(16), byte => alphabet[byte % alphabet.length]).join("");
const fixture = { table: null, code: null, tableSession: null, orders: [], qrSessions: [], qrOrders: [], invite: null,
  trust: null, staffSession: null, hosTrust: null, hosStaffSession: null };
const one = async (sql, args = []) => (await db.execute(sql, args))[0][0] ?? null;
const api = async (path, cookie) => {
  const response = await fetch(new URL(path, base), { headers: cookie ? { cookie } : {}, cache: "no-store", redirect: "manual" });
  return { response, body: response.headers.get("content-type")?.includes("json") ? await response.json() : null };
};
const cookieFrom = response => {
  const value = response.headers.get("set-cookie")?.match(/tdkon_qr_session=([^;,]+)/)?.[1];
  assert.ok(value);
  return `tdkon_qr_session=${value}`;
};
async function cleanup() {
  if (fixture.table === null) return;
  await db.beginTransaction();
  try {
    if (fixture.invite !== null) await db.execute("DELETE FROM qr_session_invites WHERE invite_id=?", [fixture.invite]);
    for (const id of fixture.qrOrders) {
      const accepted = await one("SELECT accepted_order_id FROM qr_orders WHERE qr_order_id=?", [id]);
      if (accepted?.accepted_order_id && !fixture.orders.includes(Number(accepted.accepted_order_id))) fixture.orders.push(Number(accepted.accepted_order_id));
    }
    for (const id of fixture.qrOrders) {
      await db.execute("DELETE FROM qr_order_item_options WHERE qr_order_item_id IN (SELECT qr_order_item_id FROM qr_order_items WHERE qr_order_id=?)", [id]);
      await db.execute("DELETE FROM qr_order_items WHERE qr_order_id=?", [id]);
      await db.execute("DELETE FROM qr_orders WHERE qr_order_id=?", [id]);
    }
    for (const id of fixture.orders) {
      await db.execute("DELETE FROM order_item_options WHERE order_item_id IN (SELECT order_item_id FROM order_items WHERE order_id=?)", [id]);
      await db.execute("DELETE FROM order_items WHERE order_id=?", [id]);
      await db.execute("DELETE FROM orders WHERE order_id=?", [id]);
    }
    for (const id of fixture.qrSessions) await db.execute("DELETE FROM qr_sessions WHERE qr_session_id=?", [id]);
    if (fixture.tableSession !== null) await db.execute("DELETE FROM table_sessions WHERE session_id=?", [fixture.tableSession]);
    if (fixture.staffSession !== null) await db.execute("DELETE FROM staff_sessions WHERE staff_session_id=?", [fixture.staffSession]);
    if (fixture.trust !== null) await db.execute("DELETE FROM program_trust_tokens WHERE token_id=?", [fixture.trust]);
    if (fixture.hosStaffSession !== null) await db.execute("DELETE FROM staff_sessions WHERE staff_session_id=?", [fixture.hosStaffSession]);
    if (fixture.hosTrust !== null) await db.execute("DELETE FROM program_trust_tokens WHERE token_id=?", [fixture.hosTrust]);
    if (fixture.code !== null) {
      await db.execute("DELETE FROM qr_table_links WHERE qr_code_id=?", [fixture.code]);
      await db.execute("DELETE FROM audit_logs WHERE entity_type='QR_CODE' AND entity_id=?", [fixture.code]);
      await db.execute("DELETE FROM qr_codes WHERE qr_code_id=? AND identifier=?", [fixture.code, identifier]);
    }
    await db.execute("DELETE FROM dining_tables WHERE table_id=? AND table_no=?", [fixture.table, `ZZT${tag}`]);
    await db.commit();
  } catch (error) { await db.rollback(); throw error; }
  assert.equal(Number((await one("SELECT COUNT(*) n FROM qr_codes WHERE identifier=?", [identifier])).n), 0);
  assert.equal(Number((await one("SELECT COUNT(*) n FROM dining_tables WHERE table_no=?", [`ZZT${tag}`])).n), 0);
  for (const [table, column, id] of [
    ["table_sessions", "session_id", fixture.tableSession], ["qr_session_invites", "invite_id", fixture.invite],
    ["staff_sessions", "staff_session_id", fixture.staffSession], ["staff_sessions", "staff_session_id", fixture.hosStaffSession],
    ["program_trust_tokens", "token_id", fixture.trust], ["program_trust_tokens", "token_id", fixture.hosTrust],
    ...fixture.qrSessions.map(id => ["qr_sessions", "qr_session_id", id]),
    ...fixture.qrOrders.map(id => ["qr_orders", "qr_order_id", id]),
    ...fixture.orders.map(id => ["orders", "order_id", id]),
  ]) {
    if (id !== null) assert.equal(Number((await one(`SELECT COUNT(*) n FROM ${table} WHERE ${column}=?`, [id])).n), 0,
      `Test row remained in ${table}`);
  }
}

try {
  assert.equal((await one("SELECT DATABASE() db")).db, "TDK_POS_TEST");
  const server = await api("/api/db-test");
  assert.equal(server.body.result?.[0]?.database_name, "TDK_POS_TEST");
  const staff = await one("SELECT staff_id FROM staff WHERE is_active=1 AND pos_enabled=1 AND hos_enabled=1 AND employee_pin_hash IS NOT NULL AND staff_code<>'000' ORDER BY staff_id LIMIT 1");
  assert.ok(staff);
  fixture.table = Number((await db.execute("INSERT INTO dining_tables (table_no,capacity,is_active) VALUES (?,8,1)", [`ZZT${tag}`]))[0].insertId);
  fixture.code = Number((await db.execute("INSERT INTO qr_codes (identifier,management_number,target_type,status,created_by_staff_id) VALUES (?,?,'TABLE_ORDER','IN_USE',?)", [identifier, `ZZM${tag}`, staff.staff_id]))[0].insertId);
  await db.execute("INSERT INTO qr_table_links (qr_code_id,table_id,assigned_by_staff_id) VALUES (?,?,?)", [fixture.code, fixture.table, staff.staff_id]);
  fixture.tableSession = Number((await db.execute("INSERT INTO table_sessions (table_id,status,session_kind,opened_by_staff_id) VALUES (?,'OPEN','DINE_IN',?)", [fixture.table, staff.staff_id]))[0].insertId);
  fixture.orders.push(Number((await db.execute("INSERT INTO orders (session_id,order_type,status,total_amount,created_by_staff_id) VALUES (?,'POS','ACCEPTED','0.00',?)", [fixture.tableSession, staff.staff_id]))[0].insertId));
  const scans = await Promise.all([api(`/tdkqrs/${identifier}`), api(`/tdkqrs/${identifier}`)]);
  for (const scan of scans) assert.equal(new URL(scan.response.headers.get("location"), base).pathname, "/qrorder/order");
  const cookies = scans.map(scan => cookieFrom(scan.response));
  assert.notEqual(cookies[0], cookies[1]);
  for (const cookie of cookies) {
    const hash = createHash("sha256").update(decodeURIComponent(cookie.split("=")[1])).digest("hex");
    const session = await one("SELECT qr_session_id,session_id,access_grant_source FROM qr_sessions WHERE token_hash=?", [hash]);
    assert.equal(session.session_id, null);
    assert.equal(session.access_grant_source, null);
    fixture.qrSessions.push(Number(session.qr_session_id));
    const own = await api("/api/qr/table-orders", cookie);
    assert.equal(own.response.status, 200);
    assert.equal(own.body.canViewOrders, false);
    assert.equal(own.body.posOrders.length, 0);
    assert.equal(own.body.confirmedSummary, undefined);
  }
  const catalog = (await api("/api/qr/menu-catalog")).body;
  const menu = catalog.menus.find(item => !catalog.modifierGroups.some(group =>
    Number(group.menuId) === Number(item.menuId) && (group.isRequired || Number(group.minSelect) > 0)));
  assert.ok(menu, "No menu without required options for isolated HTTP orders");
  const requestIds = [randomUUID(), randomUUID()];
  const submitted = await Promise.all(cookies.map((cookie, index) => fetch(new URL("/api/qr/table-orders", base), {
    method: "POST", headers: { cookie, origin: base.origin, "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestIds[index], cart: [{ menuId: Number(menu.menuId), qty: 1, options: [] }] }),
  }).then(async response => ({ status: response.status, body: await response.json() }))));
  fixture.qrOrders.push(...submitted.flatMap(result => Number.isSafeInteger(Number(result.body.qrOrderId)) ? [Number(result.body.qrOrderId)] : []));
  for (const result of submitted) {
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.status, "PENDING");
  }
  const duplicate = await fetch(new URL("/api/qr/table-orders", base), { method: "POST",
    headers: { cookie: cookies[0], origin: base.origin, "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestIds[0], cart: [{ menuId: Number(menu.menuId), qty: 1, options: [] }] }),
  }).then(response => response.json());
  assert.equal(duplicate.duplicate, true);
  assert.equal(Number(duplicate.qrOrderId), fixture.qrOrders[0]);
  for (let i = 0; i < 2; i++) {
    const own = await api("/api/qr/table-orders", cookies[i]);
    assert.deepEqual(own.body.ownRequests.map(order => Number(order.qrOrderId)), [fixture.qrOrders[i]]);
    assert.equal(own.body.orders.length, 0);
    assert.equal(own.body.canViewOrders, false);
  }
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
  const prematureClose = await fetch(new URL(`/api/table-sessions/${fixture.tableSession}`, base), {
    method: "PATCH", headers: { cookie: staffCookie, origin: base.origin },
  });
  assert.equal(prematureClose.status, 409, "Table closure must wait for unbound pending QR requests");
  assert.equal((await one("SELECT status FROM table_sessions WHERE session_id=?", [fixture.tableSession])).status, "OPEN");
  const accept = await fetch(new URL("/api/pos/qr-table-orders", base), { method: "PATCH",
    headers: { cookie: staffCookie, origin: base.origin, "content-type": "application/json" },
    body: JSON.stringify({ qrOrderId: fixture.qrOrders[0], action: "ACCEPT" }),
  }).then(async response => ({ status: response.status, body: await response.json() }));
  if (Number.isSafeInteger(Number(accept.body.acceptedOrderId))) fixture.orders.push(Number(accept.body.acceptedOrderId));
  assert.equal(accept.status, 200, JSON.stringify(accept.body));
  assert.equal(accept.body.success, true);
  const acceptedCustomer = await one("SELECT session_id,access_grant_source,access_grant_qr_order_id FROM qr_sessions WHERE qr_session_id=?", [fixture.qrSessions[0]]);
  assert.equal(Number(acceptedCustomer.session_id), fixture.tableSession);
  assert.equal(acceptedCustomer.access_grant_source, "ORDER_APPROVED");
  assert.equal(Number(acceptedCustomer.access_grant_qr_order_id), fixture.qrOrders[0]);
  const approved = await api("/api/qr/table-orders", cookies[0]);
  const pending = await api("/api/qr/table-orders", cookies[1]);
  assert.equal(approved.body.canViewOrders, true);
  assert.equal(approved.body.posOrders.length, 2);
  assert.deepEqual(approved.body.orders.map(order => Number(order.qrOrderId)), [fixture.qrOrders[0]]);
  assert.deepEqual(approved.body.ownRequests.map(order => Number(order.qrOrderId)), [fixture.qrOrders[0]]);
  assert.equal(Number(approved.body.confirmedSummary.grossAmount), Number(menu.price));
  assert.equal(approved.body.posOrders.reduce((total, order) => total + Number(order.effectiveTotalAmount), 0),
    Number(approved.body.confirmedSummary.grossAmount));
  assert.equal(pending.body.canViewOrders, false);
  assert.equal(pending.body.posOrders.length, 0);
  assert.equal(pending.body.confirmedSummary, undefined);
  assert.deepEqual(pending.body.ownRequests.map(order => Number(order.qrOrderId)), [fixture.qrOrders[1]]);
  assert.equal(pending.body.orders.length, 0);
  await db.execute("UPDATE qr_sessions SET access_grant_qr_order_id=? WHERE qr_session_id=?", [fixture.qrOrders[1], fixture.qrSessions[0]]);
  assert.equal((await api("/api/qr/table-orders", cookies[0])).body.canViewOrders, false, "Unapproved order is not grant proof");
  await db.execute("UPDATE qr_sessions SET access_grant_qr_order_id=? WHERE qr_session_id=?", [fixture.qrOrders[0], fixture.qrSessions[0]]);
  const repeated = await fetch(new URL("/api/pos/qr-table-orders", base), { method: "PATCH",
    headers: { cookie: staffCookie, origin: base.origin, "content-type": "application/json" },
    body: JSON.stringify({ qrOrderId: fixture.qrOrders[0], action: "ACCEPT" }),
  });
  assert.equal(repeated.status, 409, "Duplicate approval must not create another POS order");
  const c = await api(`/tdkqrs/${identifier}`);
  assert.equal(new URL(c.response.headers.get("location"), base).pathname, "/qrorder/order");
  cookies.push(cookieFrom(c.response));
  const cHash = createHash("sha256").update(decodeURIComponent(cookies[2].split("=")[1])).digest("hex");
  fixture.qrSessions.push(Number((await one("SELECT qr_session_id FROM qr_sessions WHERE token_hash=?", [cHash])).qr_session_id));
  assert.equal((await api("/api/qr/table-orders", cookies[2])).body.canViewOrders, false);
  const acceptB = await fetch(new URL("/api/pos/qr-table-orders", base), { method: "PATCH",
    headers: { cookie: hosCookie, origin: base.origin, "content-type": "application/json" },
    body: JSON.stringify({ qrOrderId: fixture.qrOrders[1], action: "ACCEPT" }),
  }).then(async response => ({ status: response.status, body: await response.json() }));
  if (Number.isSafeInteger(Number(acceptB.body.acceptedOrderId))) fixture.orders.push(Number(acceptB.body.acceptedOrderId));
  assert.equal(acceptB.status, 200, JSON.stringify(acceptB.body));
  assert.equal((await api("/api/qr/table-orders", cookies[1])).body.canViewOrders, true);
  const afterTwoApprovals = await api("/api/qr/table-orders", cookies[0]);
  assert.equal(afterTwoApprovals.body.posOrders.length, 3);
  assert.equal(Number(afterTwoApprovals.body.confirmedSummary.grossAmount), Number(menu.price) * 2);
  assert.equal(afterTwoApprovals.body.posOrders.reduce((total, order) => total + Number(order.effectiveTotalAmount), 0),
    Number(afterTwoApprovals.body.confirmedSummary.grossAmount));
  const currentSessions = await one("SELECT COUNT(*) n FROM table_sessions WHERE table_id=? AND status='OPEN'", [fixture.table]);
  assert.equal(Number(currentSessions.n), 1);
  const raceScans = await Promise.all([api(`/tdkqrs/${identifier}`), api(`/tdkqrs/${identifier}`)]);
  const raceCookies = raceScans.map(scan => cookieFrom(scan.response));
  for (const cookie of raceCookies) {
    const hash = createHash("sha256").update(decodeURIComponent(cookie.split("=")[1])).digest("hex");
    fixture.qrSessions.push(Number((await one("SELECT qr_session_id FROM qr_sessions WHERE token_hash=?", [hash])).qr_session_id));
    cookies.push(cookie);
  }
  const raceSubmissions = await Promise.all(raceCookies.map(cookie => fetch(new URL("/api/qr/table-orders", base), {
    method: "POST", headers: { cookie, origin: base.origin, "content-type": "application/json" },
    body: JSON.stringify({ requestId: randomUUID(), cart: [{ menuId: Number(menu.menuId), qty: 1, options: [] }] }),
  }).then(async response => ({ status: response.status, body: await response.json() }))));
  fixture.qrOrders.push(...raceSubmissions.flatMap(result => Number.isSafeInteger(Number(result.body.qrOrderId)) ? [Number(result.body.qrOrderId)] : []));
  for (const result of raceSubmissions) assert.equal(result.status, 201, JSON.stringify(result.body));
  const raceApprovals = await Promise.all(raceSubmissions.map((result, index) => fetch(new URL("/api/pos/qr-table-orders", base), {
    method: "PATCH", headers: { cookie: index === 0 ? staffCookie : hosCookie, origin: base.origin, "content-type": "application/json" },
    body: JSON.stringify({ qrOrderId: result.body.qrOrderId, action: "ACCEPT" }),
  }).then(async response => ({ status: response.status, body: await response.json() }))));
  fixture.orders.push(...raceApprovals.flatMap(result => Number.isSafeInteger(Number(result.body.acceptedOrderId)) ? [Number(result.body.acceptedOrderId)] : []));
  for (const result of raceApprovals) assert.equal(result.status, 200, JSON.stringify(result.body));
  for (const cookie of raceCookies) assert.equal((await api("/api/qr/table-orders", cookie)).body.canViewOrders, true);
  assert.equal(Number((await one("SELECT COUNT(*) n FROM table_sessions WHERE table_id=? AND status='OPEN'", [fixture.table])).n), 1);
  const response = await fetch(new URL("/api/qr/order-invites", base), { method: "POST", headers: { cookie: cookies[0], origin: base.origin } });
  const invite = await response.json();
  assert.equal(response.status, 200);
  assert.equal(invite.success, true);
  const inviteToken = new URL(invite.url).pathname.split("/").at(-1);
  fixture.invite = Number((await one("SELECT invite_id FROM qr_session_invites WHERE token_hash=?", [createHash("sha256").update(inviteToken).digest("hex")])).invite_id);
  const join = await api(`/tdkqrs/join/${inviteToken}`, cookies[2]);
  assert.equal(new URL(join.response.headers.get("location"), base).pathname, "/qrorder");
  const joined = await one("SELECT session_id,access_grant_source,access_grant_invite_id FROM qr_sessions WHERE qr_session_id=?", [fixture.qrSessions[2]]);
  assert.equal(Number(joined.session_id), fixture.tableSession);
  assert.equal(joined.access_grant_source, "INVITED");
  assert.equal(Number(joined.access_grant_invite_id), fixture.invite);
  assert.equal((await api("/api/qr/table-orders", cookies[2])).body.canViewOrders, true);
  const extraRequest = async cookie => {
    const result = await fetch(new URL("/api/qr/table-orders", base), { method: "POST",
      headers: { cookie, origin: base.origin, "content-type": "application/json" },
      body: JSON.stringify({ requestId: randomUUID(), cart: [{ menuId: Number(menu.menuId), qty: 1, options: [] }] }),
    }).then(async response => ({ status: response.status, body: await response.json() }));
    assert.equal(result.status, 201, JSON.stringify(result.body));
    fixture.qrOrders.push(Number(result.body.qrOrderId));
    return Number(result.body.qrOrderId);
  };
  const aPendingId = await extraRequest(cookies[0]);
  const bPendingId = await extraRequest(cookies[1]);
  const cRejectedId = await extraRequest(cookies[2]);
  const rejectC = await fetch(new URL("/api/pos/qr-table-orders", base), { method: "PATCH",
    headers: { cookie: staffCookie, origin: base.origin, "content-type": "application/json" },
    body: JSON.stringify({ qrOrderId: cRejectedId, action: "REJECT" }),
  });
  assert.equal(rejectC.status, 200);
  for (const [cookie, ownId, otherIds] of [
    [cookies[0], aPendingId, [bPendingId, cRejectedId]],
    [cookies[1], bPendingId, [aPendingId, cRejectedId]],
    [cookies[2], cRejectedId, [aPendingId, bPendingId]],
  ]) {
    const result = (await api("/api/qr/table-orders", cookie)).body;
    assert.equal(result.canViewOrders, true);
    assert.ok(result.ownRequests.some(order => Number(order.qrOrderId) === ownId));
    assert.ok(result.ownRequestItems.some(item => Number(item.qrOrderId) === ownId));
    assert.ok(result.orders.every(order => order.status === "ACCEPTED"));
    assert.ok(result.orders.every(order => !otherIds.includes(Number(order.qrOrderId))));
    assert.ok(result.items.every(item => !otherIds.includes(Number(item.qrOrderId))));
    assert.ok(result.ownRequests.every(order => !otherIds.includes(Number(order.qrOrderId))));
    assert.ok(result.ownRequestItems.every(item => !otherIds.includes(Number(item.qrOrderId))));
  }
  for (const qrOrderId of [aPendingId, bPendingId]) {
    const response = await fetch(new URL("/api/pos/qr-table-orders", base), { method: "PATCH",
      headers: { cookie: staffCookie, origin: base.origin, "content-type": "application/json" },
      body: JSON.stringify({ qrOrderId, action: "REJECT" }),
    });
    assert.equal(response.status, 200);
  }
  const aAfterRejection = (await api("/api/qr/table-orders", cookies[0])).body;
  assert.ok(aAfterRejection.ownRequests.some(order => Number(order.qrOrderId) === aPendingId && order.status === "REJECTED"));
  assert.ok(aAfterRejection.orders.every(order => Number(order.qrOrderId) !== aPendingId));
  await db.execute("UPDATE qr_sessions SET access_grant_invite_id=NULL WHERE qr_session_id=?", [fixture.qrSessions[2]]);
  assert.equal((await api("/api/qr/table-orders", cookies[2])).body.canViewOrders, false, "Missing invite proof must deny full history");
  await db.execute("UPDATE qr_sessions SET access_grant_invite_id=? WHERE qr_session_id=?", [fixture.invite, fixture.qrSessions[2]]);
  await db.execute("UPDATE qr_session_invites SET expires_at=DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE invite_id=?", [fixture.invite]);
  const lateScan = await api(`/tdkqrs/${identifier}`);
  const lateCookie = cookieFrom(lateScan.response);
  cookies.push(lateCookie);
  const lateHash = createHash("sha256").update(decodeURIComponent(lateCookie.split("=")[1])).digest("hex");
  fixture.qrSessions.push(Number((await one("SELECT qr_session_id FROM qr_sessions WHERE token_hash=?", [lateHash])).qr_session_id));
  const expiredJoin = await api(`/tdkqrs/join/${inviteToken}`, lateCookie);
  assert.equal(new URL(expiredJoin.response.headers.get("location"), base).pathname, "/qrorder/invite-invalid");
  assert.equal((await api("/api/qr/table-orders", lateCookie)).body.canViewOrders, false);
  assert.equal((await api("/api/qr/table-orders", cookies[2])).body.canViewOrders, true, "Expired invite does not revoke an already joined customer");
  await db.execute("UPDATE qr_codes SET status='RETIRED' WHERE qr_code_id=?", [fixture.code]);
  assert.equal((await api("/api/qr/table-orders", cookies[0])).body.canViewOrders, true, "QR replacement must preserve approved customer access");
  assert.equal(new URL((await api(`/tdkqrs/${identifier}`)).response.headers.get("location"), base).pathname, "/qrorder/unavailable");
  await db.execute("UPDATE qr_codes SET status='IN_USE' WHERE qr_code_id=?", [fixture.code]);
  const closingScan = await api(`/tdkqrs/${identifier}`);
  const closingCookie = cookieFrom(closingScan.response);
  cookies.push(closingCookie);
  const closingHash = createHash("sha256").update(decodeURIComponent(closingCookie.split("=")[1])).digest("hex");
  fixture.qrSessions.push(Number((await one("SELECT qr_session_id FROM qr_sessions WHERE token_hash=?", [closingHash])).qr_session_id));
  const closingRequest = await fetch(new URL("/api/qr/table-orders", base), { method: "POST",
    headers: { cookie: closingCookie, origin: base.origin, "content-type": "application/json" },
    body: JSON.stringify({ requestId: randomUUID(), cart: [{ menuId: Number(menu.menuId), qty: 1, options: [] }] }),
  }).then(response => response.json());
  fixture.qrOrders.push(Number(closingRequest.qrOrderId));
  assert.equal(closingRequest.status, "PENDING");
  const [closeRace, approveRace] = await Promise.all([
    fetch(new URL(`/api/table-sessions/${fixture.tableSession}`, base), { method: "PATCH", headers: { cookie: staffCookie, origin: base.origin } })
      .then(async response => ({ status: response.status, body: await response.json() })),
    fetch(new URL("/api/pos/qr-table-orders", base), { method: "PATCH",
      headers: { cookie: staffCookie, origin: base.origin, "content-type": "application/json" },
      body: JSON.stringify({ qrOrderId: closingRequest.qrOrderId, action: "ACCEPT" }),
    }).then(async response => ({ status: response.status, body: await response.json() })),
  ]);
  if (Number.isSafeInteger(Number(approveRace.body.acceptedOrderId))) fixture.orders.push(Number(approveRace.body.acceptedOrderId));
  assert.equal(approveRace.status, 200, JSON.stringify(approveRace.body));
  assert.ok(closeRace.status === 200 || closeRace.status === 409, JSON.stringify(closeRace));
  const finalStatus = (await one("SELECT status FROM table_sessions WHERE session_id=?", [fixture.tableSession])).status;
  assert.equal(finalStatus, closeRace.status === 200 ? "CLOSED" : "OPEN");
  assert.equal(Number((await one("SELECT COUNT(*) n FROM table_sessions WHERE table_id=?", [fixture.table])).n), 1);
  if (finalStatus === "OPEN") await db.execute("UPDATE table_sessions SET status='CLOSED',closed_at=NOW() WHERE session_id=?", [fixture.tableSession]);
  for (const cookie of cookies) {
    const closed = await api("/api/qr/table-orders", cookie);
    assert.ok(closed.response.status === 401 || closed.body.canViewOrders === false);
    assert.equal(closed.body.orders?.length ?? 0, 0);
  }
  console.log("PASS: concurrent submissions and approvals, POS-first session reuse, duplicate rejection, invite source, closed-session revocation");
} finally { try { await cleanup(); } finally { await db.end(); } }
