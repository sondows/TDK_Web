/* eslint-disable @typescript-eslint/no-require-imports -- Standalone TEST database runner. */
const assert = require("node:assert/strict");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

const origin = process.env.TDK_QR_TEST_BASE_URL?.trim() ?? "http://127.0.0.1:3000";
const token = () => randomBytes(32).toString("base64url");
const hash = value => createHash("sha256").update(value).digest("hex");
const identifier = () => "A" + randomBytes(12).toString("hex").slice(0, 15);
const redirectPath = response => new URL(response.headers.get("location"), origin).pathname;

async function request(path, options = {}) {
  return fetch(`${origin}${path}`, { redirect: "manual", signal: AbortSignal.timeout(15000), ...options });
}

async function makeInvite(connection, sessionId, rootQrSessionId, expiresAtSql, revoked = false) {
  const raw = token();
  const [row] = await connection.query(
    `INSERT INTO qr_session_invites (session_id, created_by_qr_session_id, token_hash, expires_at, revoked_at)
     VALUES (?, ?, ?, ${expiresAtSql}, ${revoked ? "CURRENT_TIMESTAMP" : "NULL"})`,
    [sessionId, rootQrSessionId, hash(raw)],
  );
  return { raw, id: Number(row.insertId) };
}

async function main() {
  assert.equal(new URL(origin).hostname, "127.0.0.1", "HTTP server must be local");
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: "TDK_POS_TEST",
    connectTimeout: 7000,
  });
  const marker = `ZZQI${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const tableIds = [];
  const qrCodeIds = [];
  const extraQrSessionIds = [];
  const extraTableSessionIds = [];
  let staffSessionId;
  let programTrustTokenId;
  let staffCookie;
  let sessionId;
  try {
    const [[identity]] = await connection.query("SELECT DATABASE() AS name");
    assert.equal(identity.name, "TDK_POS_TEST");
    const dbResponse = await request("/api/db-test");
    const dbPayload = await dbResponse.json();
    assert.equal(dbPayload.result?.[0]?.database_name, "TDK_POS_TEST", "HTTP server must use TEST DB");
    const [[staff]] = await connection.query("SELECT staff_id FROM staff WHERE is_active = 1 AND pos_enabled = 1 AND staff_code <> '000' ORDER BY staff_id LIMIT 1");
    assert.ok(staff);
    const staffToken = token();
    const trustToken = token();
    const [trust] = await connection.query(
      "INSERT INTO program_trust_tokens (program, token_hash, enrolled_by_staff_id) VALUES ('POS', ?, ?)",
      [hash(trustToken), staff.staff_id],
    );
    programTrustTokenId = Number(trust.insertId);
    const [staffSession] = await connection.query(
      "INSERT INTO staff_sessions (staff_id, trust_token_id, session_token_hash, session_type, status) VALUES (?, ?, ?, 'POS', 'ACTIVE')",
      [staff.staff_id, programTrustTokenId, hash(staffToken)],
    );
    staffSessionId = Number(staffSession.insertId);
    staffCookie = `tdk_pos_session=${staffToken}; tdk_pos_trust_${programTrustTokenId}=${trustToken}`;

    for (const suffix of ["A", "B"]) {
      const [table] = await connection.query(
        "INSERT INTO dining_tables (table_no, table_name, capacity, is_active) VALUES (?, ?, 4, 1)",
        [`${marker}${suffix}`, `QR invite integration ${suffix}`],
      );
      const tableId = Number(table.insertId);
      tableIds.push(tableId);
      const [code] = await connection.query(
        "INSERT INTO qr_codes (identifier, management_number, target_type, status, created_by_staff_id) VALUES (?, ?, 'TABLE_ORDER', 'IN_USE', ?)",
        [identifier(), `${marker}${suffix}`, staff.staff_id],
      );
      qrCodeIds.push(Number(code.insertId));
      await connection.query("INSERT INTO qr_table_links (qr_code_id, table_id, assigned_by_staff_id) VALUES (?, ?, ?)",
        [code.insertId, tableId, staff.staff_id]);
    }
    const [tableSession] = await connection.query(
      "INSERT INTO table_sessions (table_id, status, session_kind) VALUES (?, 'OPEN', 'DINE_IN')", [tableIds[0]],
    );
    sessionId = Number(tableSession.insertId);
    const [root] = await connection.query(
      "INSERT INTO qr_sessions (session_id, table_id, token_hash, status, last_active_at) VALUES (?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)",
      [sessionId, tableIds[0], hash(token())],
    );
    const rootQrSessionId = Number(root.insertId);
    await connection.query(
      "INSERT INTO qr_orders (qr_session_id, status, accepted_at) VALUES (?, 'ACCEPTED', CURRENT_TIMESTAMP)",
      [rootQrSessionId],
    );

    const invalidFormat = await request("/tdkqrs/join/not-a-token");
    assert.equal(redirectPath(invalidFormat), "/qrorder/invite-invalid");
    const nonexistent = await request(`/tdkqrs/join/${token()}`);
    assert.equal(redirectPath(nonexistent), "/qrorder/invite-invalid");
    const withoutCookie = await request("/api/qr/table-orders", { headers: { origin } });
    assert.equal(withoutCookie.status, 401);

    const expired = await makeInvite(connection, sessionId, rootQrSessionId, "DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 SECOND)");
    assert.equal(redirectPath(await request(`/tdkqrs/join/${expired.raw}`)), "/qrorder/invite-invalid");
    const revoked = await makeInvite(connection, sessionId, rootQrSessionId, "DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)", true);
    assert.equal(redirectPath(await request(`/tdkqrs/join/${revoked.raw}`)), "/qrorder/invite-invalid");
    const [[beforeJoin]] = await connection.query("SELECT COUNT(*) AS count FROM qr_sessions WHERE session_id = ?", [sessionId]);
    assert.equal(Number(beforeJoin.count), 1, "invalid invites do not create guest sessions");

    const invite = await makeInvite(connection, sessionId, rootQrSessionId, "DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)");
    const [[storedInvite]] = await connection.query("SELECT token_hash, redeemed_at FROM qr_session_invites WHERE invite_id = ?", [invite.id]);
    assert.equal(storedInvite.token_hash, hash(invite.raw));
    assert.notEqual(storedInvite.token_hash, invite.raw);
    assert.equal(storedInvite.redeemed_at, null);

    const joined = await request(`/tdkqrs/join/${invite.raw}`, { headers: { "x-forwarded-proto": "https" } });
    assert.equal(joined.status, 302);
    assert.equal(redirectPath(joined), "/qrorder");
    const setCookie = joined.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /tdkon_qr_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /Path=\//);
    assert.match(setCookie, /Max-Age=[1-9][0-9]*/);
    const maxAge = Number(setCookie.match(/Max-Age=(\d+)/)?.[1]);
    assert.ok(maxAge > 0 && maxAge <= 3600, "invite cookie cannot outlive invite expiry");
    const cookie = setCookie.split(";", 1)[0];
    const rawCookieToken = decodeURIComponent(cookie.split("=", 2)[1]);
    const [guestRows] = await connection.query(
      "SELECT qr_session_id, session_id, table_id, token_hash, status FROM qr_sessions WHERE session_id = ? AND qr_session_id <> ?",
      [sessionId, rootQrSessionId],
    );
    assert.equal(guestRows.length, 1);
    assert.equal(Number(guestRows[0].table_id), tableIds[0]);
    assert.equal(guestRows[0].token_hash, hash(rawCookieToken));
    assert.notEqual(guestRows[0].token_hash, rawCookieToken);
    const [[redeemed]] = await connection.query("SELECT redeemed_at FROM qr_session_invites WHERE invite_id = ?", [invite.id]);
    assert.ok(redeemed.redeemed_at);

    const page = await request("/qrorder", { headers: { cookie } });
    assert.equal(page.status, 200);
    const tableOrders = await request("/api/qr/table-orders", { headers: { cookie, origin } });
    const tableOrdersBody = await tableOrders.json();
    assert.equal(tableOrders.status, 200);
    assert.equal(tableOrdersBody.tableNo, `${marker}A`);
    const menuResponse = await request("/api/qr/menu-catalog");
    const catalog = await menuResponse.json();
    assert.equal(menuResponse.status, 200);
    const groupsFor = menuId => {
      const groups = new Map();
      for (const row of catalog.modifierGroups.filter(item => item.menuId === menuId)) {
        if (!groups.has(row.modifierGroupId)) groups.set(row.modifierGroupId, { minSelect: Number(row.minSelect), defaultOptionId: row.defaultOptionId, options: [] });
        groups.get(row.modifierGroupId).options.push(row);
      }
      return [...groups.values()];
    };
    const menu = catalog.menus.find(item => groupsFor(item.menuId).every(group => group.minSelect === 0)) ?? catalog.menus[0];
    assert.ok(menu);
    const options = groupsFor(menu.menuId).flatMap(group => {
      const chosen = [];
      if (group.defaultOptionId && group.options.some(option => option.modifierOptionId === group.defaultOptionId)) chosen.push(group.defaultOptionId);
      for (const option of group.options) {
        if (chosen.length >= group.minSelect) break;
        if (!chosen.includes(option.modifierOptionId)) chosen.push(option.modifierOptionId);
      }
      return chosen.map(modifierOptionId => ({ modifierOptionId, qty: 1 }));
    });
    const order = await request("/api/qr/table-orders", {
      method: "POST", headers: { cookie, origin, "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: randomUUID(), cart: [{ menuId: menu.menuId, qty: 1, options }] }),
    });
    const orderBody = await order.json();
    assert.ok([200, 201].includes(order.status), `guest order: ${order.status} ${orderBody.message ?? ""}`);
    assert.equal(orderBody.success, true);
    const [[guestOrder]] = await connection.query("SELECT status FROM qr_orders WHERE qr_session_id = ?", [guestRows[0].qr_session_id]);
    assert.equal(guestOrder.status, "PENDING");

    const repeatWithCookie = await request(`/tdkqrs/join/${invite.raw}`, { headers: { cookie } });
    assert.equal(redirectPath(repeatWithCookie), "/qrorder");
    assert.equal(repeatWithCookie.headers.get("set-cookie"), null);
    const [afterRepeat] = await connection.query("SELECT qr_session_id FROM qr_sessions WHERE session_id = ?", [sessionId]);
    assert.equal(afterRepeat.length, 2);

    // An explicit invite reuses this customer's active unbound token so an
    // already-submitted pending order remains attached and visible to staff.
    const pendingToken = token();
    const [pendingSession] = await connection.query(
      "INSERT INTO qr_sessions (session_id, table_id, token_hash, status, last_active_at) VALUES (NULL, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)",
      [tableIds[0], hash(pendingToken)],
    );
    const pendingQrSessionId = Number(pendingSession.insertId);
    extraQrSessionIds.push(pendingQrSessionId);
    const [pendingQrOrder] = await connection.query(
      "INSERT INTO qr_orders (qr_session_id, status) VALUES (?, 'PENDING')", [pendingQrSessionId],
    );
    const pendingInvite = await makeInvite(connection, sessionId, rootQrSessionId, "DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)");
    const pendingJoin = await request(`/tdkqrs/join/${pendingInvite.raw}`, {
      headers: { cookie: `tdkon_qr_session=${pendingToken}` },
    });
    assert.equal(redirectPath(pendingJoin), "/qrorder");
    assert.equal(pendingJoin.headers.get("set-cookie"), null, "same-table live customer token is reused");
    const [[joinedPendingSession]] = await connection.query(
      "SELECT session_id, status FROM qr_sessions WHERE qr_session_id = ?", [pendingQrSessionId],
    );
    assert.equal(Number(joinedPendingSession.session_id), sessionId);
    assert.equal(joinedPendingSession.status, "ACTIVE");
    const [[preservedPendingOrder]] = await connection.query(
      "SELECT qr_session_id, status FROM qr_orders WHERE qr_order_id = ?", [pendingQrOrder.insertId],
    );
    assert.equal(Number(preservedPendingOrder.qr_session_id), pendingQrSessionId);
    assert.equal(preservedPendingOrder.status, "PENDING");

    // The existing route permits a second customer to redeem the same unexpired invite.
    const secondGuest = await request(`/tdkqrs/join/${invite.raw}`);
    assert.equal(redirectPath(secondGuest), "/qrorder");
    assert.match(secondGuest.headers.get("set-cookie") ?? "", /tdkon_qr_session=/);
    const [afterSecond] = await connection.query("SELECT qr_session_id FROM qr_sessions WHERE session_id = ?", [sessionId]);
    assert.equal(afterSecond.length, 4);

    const [[otherQr]] = await connection.query("SELECT identifier FROM qr_codes WHERE qr_code_id = ?", [qrCodeIds[1]]);
    const otherTable = await request(`/tdkqrs/${otherQr.identifier}`, { headers: { cookie } });
    assert.equal(redirectPath(otherTable), "/qrorder/unavailable");
    await connection.query("UPDATE dining_tables SET is_active = 0 WHERE table_id = ?", [tableIds[0]]);
    assert.equal(redirectPath(await request(`/tdkqrs/join/${invite.raw}`)), "/qrorder/invite-invalid");
    await connection.query("UPDATE dining_tables SET is_active = 1 WHERE table_id = ?", [tableIds[0]]);
    await connection.query("UPDATE qr_codes SET status = 'LOCKED' WHERE qr_code_id = ?", [qrCodeIds[0]]);
    assert.equal(redirectPath(await request(`/tdkqrs/join/${invite.raw}`)), "/qrorder/invite-invalid");
    await connection.query("UPDATE qr_codes SET status = 'IN_USE' WHERE qr_code_id = ?", [qrCodeIds[0]]);
    await connection.query("UPDATE table_sessions SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP WHERE session_id = ?", [sessionId]);
    assert.equal(redirectPath(await request(`/tdkqrs/join/${invite.raw}`)), "/qrorder/invite-invalid");
    const [[afterInvalid]] = await connection.query("SELECT COUNT(*) AS count FROM qr_sessions WHERE session_id = ?", [sessionId]);
    assert.equal(Number(afterInvalid.count), 4, "disabled or closed targets do not create guest sessions");
    const afterClose = await request("/api/qr/table-orders", { headers: { cookie, origin } });
    assert.ok([401, 409].includes(afterClose.status), "closed table session rejects guest access");

    // A second table has an open session and an independent pending order.
    // Approval, not an invite, grants visit-history access to its customer.
    const [otherTableSession] = await connection.query(
      "INSERT INTO table_sessions (table_id, status, session_kind) VALUES (?, 'OPEN', 'DINE_IN')", [tableIds[1]],
    );
    const otherTableSessionId = Number(otherTableSession.insertId);
    extraTableSessionIds.push(otherTableSessionId);
    const uninvitedToken = token();
    const [uninvitedSession] = await connection.query(
      "INSERT INTO qr_sessions (session_id, table_id, token_hash, status) VALUES (NULL, ?, ?, 'ACTIVE')",
      [tableIds[1], hash(uninvitedToken)],
    );
    const uninvitedQrSessionId = Number(uninvitedSession.insertId);
    extraQrSessionIds.push(uninvitedQrSessionId);
    const [uninvitedOrder] = await connection.query(
      "INSERT INTO qr_orders (qr_session_id, status) VALUES (?, 'PENDING')", [uninvitedQrSessionId],
    );
    const staffResponse = await request("/api/pos/qr-table-orders", { headers: { cookie: staffCookie, "x-tdk-local-dev": "1" } });
    const staffPayload = await staffResponse.json();
    assert.equal(staffResponse.status, 200, JSON.stringify(staffPayload));
    const shownUninvited = staffPayload.orders.find(order => order.qrOrderId === Number(uninvitedOrder.insertId));
    assert.equal(shownUninvited?.canAccept, true, "staff may review a valid QR order without an invite");
    assert.equal(shownUninvited?.blockedReason, null);
    const uninvitedHistory = await request("/api/qr/table-orders", {
      headers: { cookie: `tdkon_qr_session=${uninvitedToken}`, origin },
    });
    const uninvitedHistoryBody = await uninvitedHistory.json();
    assert.equal(uninvitedHistory.status, 200);
    assert.equal(uninvitedHistoryBody.canViewOrders, false, "pending order does not grant visit history");
    assert.equal(uninvitedHistoryBody.posOrders.length, 0);
    assert.equal(uninvitedHistoryBody.ownRequests.length, 1, "customer can still view their own request");
    const [[stillPending]] = await connection.query("SELECT status FROM qr_orders WHERE qr_order_id = ?", [uninvitedOrder.insertId]);
    assert.equal(stillPending.status, "PENDING", "uninvited order remains pending, not implicitly rejected");

    const expiredToken = token();
    const [expiredSession] = await connection.query(
      "INSERT INTO qr_sessions (session_id, table_id, token_hash, status, created_at) VALUES (NULL, ?, ?, 'ACTIVE', DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 HOUR))",
      [tableIds[1], hash(expiredToken)],
    );
    const expiredQrSessionId = Number(expiredSession.insertId);
    extraQrSessionIds.push(expiredQrSessionId);
    const [expiredOrder] = await connection.query(
      "INSERT INTO qr_orders (qr_session_id, status) VALUES (?, 'PENDING')", [expiredQrSessionId],
    );
    const refreshedQueue = await request("/api/pos/qr-table-orders", { headers: { cookie: staffCookie, "x-tdk-local-dev": "1" } });
    const refreshedPayload = await refreshedQueue.json();
    const shownExpired = refreshedPayload.orders.find(order => order.qrOrderId === Number(expiredOrder.insertId));
    assert.equal(shownExpired?.canAccept, false);
    assert.equal(shownExpired?.blockedReason, "EXPIRED");
    const expiredAcceptance = await request("/api/pos/qr-table-orders", {
      method: "PATCH", headers: { cookie: staffCookie, "x-tdk-local-dev": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ qrOrderId: Number(expiredOrder.insertId), action: "ACCEPT" }),
    });
    assert.equal(expiredAcceptance.status, 422);
    const [[expiredStillPending]] = await connection.query("SELECT status FROM qr_orders WHERE qr_order_id = ?", [expiredOrder.insertId]);
    assert.equal(expiredStillPending.status, "PENDING", "expired order remains pending");
    console.log("PASS: invite join/token preservation, approval-based access isolation, six-hour expiry blocks acceptance, invite and session guards");
  } finally {
    await new Promise(resolve => setTimeout(resolve, 500));
    if (tableIds.length || qrCodeIds.length || staffSessionId || programTrustTokenId) {
      await connection.beginTransaction();
      try {
        if (qrCodeIds.length) await connection.query("DELETE FROM audit_logs WHERE entity_type = 'QR_CODE' AND entity_id IN (?)", [qrCodeIds]);
        if (sessionId !== undefined) {
          await connection.query("DELETE FROM qr_order_item_options WHERE qr_order_item_id IN (SELECT i.qr_order_item_id FROM qr_order_items i JOIN qr_orders o ON o.qr_order_id = i.qr_order_id JOIN qr_sessions s ON s.qr_session_id = o.qr_session_id WHERE s.session_id = ?)", [sessionId]);
          await connection.query("DELETE FROM qr_order_items WHERE qr_order_id IN (SELECT o.qr_order_id FROM qr_orders o JOIN qr_sessions s ON s.qr_session_id = o.qr_session_id WHERE s.session_id = ?)", [sessionId]);
          await connection.query("DELETE FROM qr_orders WHERE qr_session_id IN (SELECT qr_session_id FROM qr_sessions WHERE session_id = ?)", [sessionId]);
          await connection.query("DELETE FROM qr_session_invites WHERE session_id = ?", [sessionId]);
          await connection.query("DELETE FROM qr_sessions WHERE session_id = ?", [sessionId]);
          await connection.query("DELETE FROM table_sessions WHERE session_id = ?", [sessionId]);
        }
        if (extraQrSessionIds.length) {
          await connection.query("DELETE FROM qr_order_item_options WHERE qr_order_item_id IN (SELECT qr_order_item_id FROM qr_order_items WHERE qr_order_id IN (SELECT qr_order_id FROM qr_orders WHERE qr_session_id IN (?)))", [extraQrSessionIds]);
          await connection.query("DELETE FROM qr_order_items WHERE qr_order_id IN (SELECT qr_order_id FROM qr_orders WHERE qr_session_id IN (?))", [extraQrSessionIds]);
          await connection.query("DELETE FROM qr_orders WHERE qr_session_id IN (?)", [extraQrSessionIds]);
          await connection.query("DELETE FROM qr_sessions WHERE qr_session_id IN (?)", [extraQrSessionIds]);
        }
        if (extraTableSessionIds.length) await connection.query("DELETE FROM table_sessions WHERE session_id IN (?)", [extraTableSessionIds]);
        if (staffSessionId) await connection.query("DELETE FROM staff_sessions WHERE staff_session_id = ?", [staffSessionId]);
        if (programTrustTokenId) await connection.query("DELETE FROM program_trust_tokens WHERE token_id = ?", [programTrustTokenId]);
        if (qrCodeIds.length) await connection.query("DELETE FROM qr_table_links WHERE qr_code_id IN (?)", [qrCodeIds]);
        if (qrCodeIds.length) await connection.query("DELETE FROM qr_codes WHERE qr_code_id IN (?)", [qrCodeIds]);
        if (tableIds.length) await connection.query("DELETE FROM dining_tables WHERE table_id IN (?)", [tableIds]);
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
    }
    const [[remaining]] = await connection.query("SELECT COUNT(*) AS count FROM dining_tables WHERE table_no LIKE ?", [`${marker}%`]);
    assert.equal(Number(remaining.count), 0, "TEST fixture removed");
    await connection.end();
  }
}

main().catch(error => {
  console.error("QR invite development verification failed", { code: error.code, message: error.message });
  process.exitCode = 1;
});
