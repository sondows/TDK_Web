/* eslint-disable @typescript-eslint/no-require-imports -- This standalone test runner is CommonJS. */
// Development-only HTTP integration check with uniquely named fixtures.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createHash, randomInt, randomUUID } = require("node:crypto");
const net = require("node:net");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const identifier = () => Array.from({ length: 16 }, () => alphabet[randomInt(alphabet.length)]).join("");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: "TDK_POS_TEST",
    connectTimeout: 7000,
  });
  let server;
  let tableId;
  let qrCodeId;
  let tableSessionId;
  let nextTableSessionId;
  let firstVisitOrderId;
  let secondTableId;
  let secondQrCodeId;
  let secondVisitId;
  let secondOrderId;
  const marker = `ZZQR${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const secondMarker = `${marker}B`;
  try {
    const [[identity]] = await connection.query("SELECT DATABASE() AS name");
    assert.equal(identity.name, "TDK_POS_TEST");
    const [[staff]] = await connection.query("SELECT staff_id FROM staff WHERE is_active = 1 ORDER BY staff_id LIMIT 1");
    assert.ok(staff, "development DB has a staff FK target");
    const existingOrigin = process.env.TDK_QR_TEST_BASE_URL?.trim();
    const port = existingOrigin ? null : await freePort();
    const origin = existingOrigin ?? `http://127.0.0.1:${port}`;
    assert.equal(new URL(origin).hostname, "127.0.0.1", "test server must be local");
    if (!existingOrigin) server = spawn(process.execPath, ["server.cjs"], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "development", DB_NAME: "TDK_POS_TEST", TDK_APP_BIND_HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let startupError = "";
    server?.stderr.on("data", chunk => { startupError = (startupError + chunk.toString()).slice(-2000); });
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      if (server && server.exitCode !== null) throw new Error(`development server exited: ${startupError}`);
      try {
        const response = await fetch(`${origin}/qrorder/unavailable`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) { ready = true; break; }
      } catch { /* Wait for Next.js startup. */ }
      await wait(1000);
    }
    assert.ok(ready, `development server did not start: ${startupError}`);
    const dbCheck = await fetch(`${origin}/api/db-test`, { signal: AbortSignal.timeout(10000) });
    const dbIdentity = await dbCheck.json();
    assert.equal(dbIdentity.result?.[0]?.database_name, "TDK_POS_TEST", "HTTP server must use TEST DB");

    const [table] = await connection.query(
      "INSERT INTO dining_tables (table_no, table_name, capacity, is_active) VALUES (?, ?, 4, 1)",
      [marker, "QR entry integration fixture"],
    );
    tableId = Number(table.insertId);
    const [code] = await connection.query(
      "INSERT INTO qr_codes (identifier, management_number, target_type, status, created_by_staff_id) VALUES (?, ?, 'TABLE_ORDER', 'IN_USE', ?)",
      [identifier(), marker, staff.staff_id],
    );
    qrCodeId = Number(code.insertId);
    const [[qr]] = await connection.query("SELECT identifier FROM qr_codes WHERE qr_code_id = ?", [qrCodeId]);
    await connection.query(
      "INSERT INTO qr_table_links (qr_code_id, table_id, assigned_by_staff_id) VALUES (?, ?, ?)",
      [qrCodeId, tableId, staff.staff_id],
    );

    const entry = await fetch(`${origin}/tdkqrs/${qr.identifier}`, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    assert.equal(entry.status, 302);
    const destination = new URL(entry.headers.get("location"), origin).pathname;
    if (destination !== "/qrorder/order") {
      await wait(200);
      const details = startupError.split(/\r?\n/).filter(line => /QR customer entry failed|phase:|name:|message:|code:|errno:|sqlState:/.test(line));
      throw new Error(`QR entry redirected to ${destination}; server diagnostics: ${details.join(" ").slice(0, 700)}`);
    }
    const setCookie = entry.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /tdkon_qr_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    const cookie = setCookie.split(";", 1)[0];
    const [issued] = await connection.query(
      "SELECT qr_session_id, session_id, table_id, status FROM qr_sessions WHERE table_id = ?", [tableId],
    );
    assert.equal(issued.length, 1);
    assert.equal(issued[0].session_id, null);
    assert.equal(Number(issued[0].table_id), tableId);
    assert.equal(issued[0].status, "ACTIVE");

    const orders = await fetch(`${origin}/api/qr/table-orders`, {
      headers: { cookie, origin }, signal: AbortSignal.timeout(15000),
    });
    const orderPayload = await orders.json();
    assert.equal(orders.status, 200);
    assert.equal(orderPayload.success, true);
    assert.equal(orderPayload.tableNo, marker);

    const menuPage = await fetch(`${origin}/qrorder/order`, {
      headers: { cookie }, signal: AbortSignal.timeout(15000),
    });
    assert.equal(menuPage.status, 200, "customer order page renders");
    const catalogResponse = await fetch(`${origin}/api/qr/menu-catalog`, { signal: AbortSignal.timeout(15000) });
    const catalog = await catalogResponse.json();
    assert.equal(catalogResponse.status, 200);
    assert.equal(catalog.success, true);
    const groupsFor = menuId => {
      const groups = new Map();
      for (const row of catalog.modifierGroups.filter(item => item.menuId === menuId)) {
        if (!groups.has(row.modifierGroupId)) groups.set(row.modifierGroupId, {
          minSelect: Number(row.minSelect), defaultOptionId: row.defaultOptionId, options: [],
        });
        groups.get(row.modifierGroupId).options.push(row);
      }
      return [...groups.values()];
    };
    const menu = catalog.menus.find(item => groupsFor(item.menuId).every(group => group.minSelect === 0)) ?? catalog.menus[0];
    assert.ok(menu, "development QR catalog has an orderable menu");
    const options = groupsFor(menu.menuId).flatMap(group => {
      const chosen = [];
      if (group.defaultOptionId && group.options.some(option => option.modifierOptionId === group.defaultOptionId)) {
        chosen.push(group.defaultOptionId);
      }
      for (const option of group.options) {
        if (chosen.length >= group.minSelect) break;
        if (!chosen.includes(option.modifierOptionId)) chosen.push(option.modifierOptionId);
      }
      return chosen.map(modifierOptionId => ({ modifierOptionId, qty: 1 }));
    });
    const authStatus = await fetch(`${origin}/api/qr/order-auth`, { headers: { cookie }, signal: AbortSignal.timeout(15000) });
    assert.ok([200, 404].includes(authStatus.status), `QR authentication status check failed: HTTP ${authStatus.status}`);
    await authStatus.arrayBuffer();
    const submitted = await fetch(`${origin}/api/qr/table-orders`, {
      method: "POST", headers: { cookie, origin, "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: randomUUID(), cart: [{ menuId: menu.menuId, qty: 1, options }] }),
      signal: AbortSignal.timeout(15000),
    });
    const submission = await submitted.json();
    const [savedOrders] = await connection.query(
      "SELECT qr_order_id, status FROM qr_orders WHERE qr_session_id = ?", [issued[0].qr_session_id],
    );
    if (authStatus.status === 200) {
      assert.equal(submitted.status, 403);
      assert.equal(submission.code, "AUTH_REQUIRED");
      assert.equal(savedOrders.length, 0, "QR entry alone cannot submit an order");
    } else {
      assert.equal(submitted.status, 201, submission.message);
      assert.equal(submission.success, true);
      assert.equal(savedOrders.length, 1);
      assert.equal(savedOrders[0].status, "PENDING");
      await connection.query("UPDATE qr_orders SET status = 'REJECTED' WHERE qr_order_id = ?", [savedOrders[0].qr_order_id]);
    }

    await connection.query("UPDATE qr_sessions SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP WHERE qr_session_id = ?", [issued[0].qr_session_id]);
    const afterClose = await fetch(`${origin}/api/qr/table-orders`, {
      headers: { cookie, origin }, signal: AbortSignal.timeout(15000),
    });
    assert.ok([401, 409].includes(afterClose.status), "closed session cannot read orders");

    // POS-first session: scanning grants read-only access to the current visit,
    // but does not bind a QR session or claim TV-7 representative order rights.
    const [sessionInsert] = await connection.query(
      "INSERT INTO table_sessions (table_id, opened_by_staff_id, session_kind, status, person_count) VALUES (?, ?, 'DINE_IN', 'OPEN', 2)",
      [tableId, staff.staff_id],
    );
    tableSessionId = Number(sessionInsert.insertId);
    const [firstVisitOrderInsert] = await connection.query(
      "INSERT INTO orders (session_id, order_type, status, subtotal_amount, discount_amount, total_amount, created_by_staff_id) VALUES (?, 'POS', 'ACCEPTED', 12000, 0, 12000, ?)",
      [tableSessionId, staff.staff_id],
    );
    firstVisitOrderId = Number(firstVisitOrderInsert.insertId);
    const firstScans = await Promise.all([0, 1].map(() => fetch(`${origin}/tdkqrs/${qr.identifier}`, {
      redirect: "manual", signal: AbortSignal.timeout(15000),
    })));
    assert.deepEqual(firstScans.map(response => new URL(response.headers.get("location"), origin).pathname),
      ["/qrorder", "/qrorder"], "customers land directly on current POS history when the visit has orders");
    const customerCookies = firstScans.map(response => (response.headers.get("set-cookie") ?? "").split(";", 1)[0]);
    customerCookies.forEach(cookie => assert.match(cookie, /tdkon_qr_session=/));
    assert.notEqual(customerCookies[0], customerCookies[1], "concurrent customers receive independent tokens");
    for (const cookie of customerCookies) {
      const orderPage = await fetch(`${origin}/qrorder/order`, {
        headers: { cookie }, signal: AbortSignal.timeout(15000),
      });
      assert.equal(orderPage.status, 200, "each customer can open the menu before order authorization");
      const historyPage = await fetch(`${origin}/qrorder`, {
        headers: { cookie }, signal: AbortSignal.timeout(15000),
      });
      assert.equal(historyPage.status, 200, "each customer can open the current-visit history screen");
    }
    const [unboundSessions] = await connection.query(
      "SELECT qr_session_id, session_id FROM qr_sessions WHERE table_id = ? AND status = 'ACTIVE' ORDER BY qr_session_id", [tableId],
    );
    assert.equal(unboundSessions.length, 2, "both customers receive distinct active QR sessions");
    assert.ok(unboundSessions.every(row => row.session_id === null), "scanning cannot grant POS visit access");
    const [[bound]] = await connection.query(
      "SELECT COUNT(*) AS count FROM qr_sessions WHERE session_id = ? AND status = 'ACTIVE'", [tableSessionId],
    );
    assert.equal(Number(bound.count), 0, "POS visit has no QR member before approval or invitation");
    const [[claim]] = await connection.query("SELECT COUNT(*) AS count FROM qr_table_order_claims WHERE table_id = ?", [tableId]);
    assert.equal(Number(claim.count), 0, "scanning cannot claim TV-7 representative order rights");
    for (const cookie of customerCookies) {
      const history = await fetch(`${origin}/api/qr/table-orders`, {
        headers: { cookie, origin }, signal: AbortSignal.timeout(15000),
      });
      const payload = await history.json();
      assert.equal(history.status, 200);
      assert.equal(payload.canViewOrders, false, "scan alone does not grant invite or representative privileges");
      assert.equal(payload.canViewCurrentVisitOrders, true, "scan can read the current open table visit");
      assert.equal(payload.needsJoin, false, "menu access does not require an invite");
      assert.equal(payload.posOrders.length, 1, "current POS-first visit history is immediately visible");
      assert.equal(payload.posOrders[0].orderId > 0, true);
      assert.equal(payload.orders.length, 0);
      assert.equal(payload.ownRequests.length, 0);
    }
    await connection.query("UPDATE table_sessions SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP WHERE session_id = ?", [tableSessionId]);
    await connection.query("UPDATE qr_sessions SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP WHERE table_id = ? AND status = 'ACTIVE'", [tableId]);
    for (const cookie of customerCookies) {
      const history = await fetch(`${origin}/api/qr/table-orders`, {
        headers: { cookie, origin }, signal: AbortSignal.timeout(15000),
      });
      assert.ok([401, 409].includes(history.status), "completed visit closes its old QR customer tokens");
    }
    const [nextSessionInsert] = await connection.query(
      "INSERT INTO table_sessions (table_id, opened_by_staff_id, session_kind, status) VALUES (?, ?, 'DINE_IN', 'OPEN')",
      [tableId, staff.staff_id],
    );
    nextTableSessionId = Number(nextSessionInsert.insertId);
    const [nextOrderInsert] = await connection.query(
      "INSERT INTO orders (session_id, order_type, status, subtotal_amount, discount_amount, total_amount, created_by_staff_id) VALUES (?, 'POS', 'ACCEPTED', 7000, 0, 7000, ?)",
      [nextTableSessionId, staff.staff_id],
    );
    const nextVisitOrderId = Number(nextOrderInsert.insertId);
    const renewedCookies = [];
    for (const cookie of customerCookies) {
      const renewed = await fetch(`${origin}/tdkqrs/${qr.identifier}`, {
        headers: { cookie }, redirect: "manual", signal: AbortSignal.timeout(15000),
      });
      assert.equal(new URL(renewed.headers.get("location"), origin).pathname, "/qrorder",
        "a new visit scan opens history for the new current visit");
      const renewedCookie = (renewed.headers.get("set-cookie") ?? "").split(";", 1)[0];
      assert.match(renewedCookie, /tdkon_qr_session=/, "a completed visit token is replaced on rescan");
      renewedCookies.push(renewedCookie);
      const history = await fetch(`${origin}/api/qr/table-orders`, {
        headers: { cookie: renewedCookie, origin }, signal: AbortSignal.timeout(15000),
      });
      const payload = await history.json();
      assert.equal(history.status, 200);
      assert.equal(payload.posOrders.length, 1, "renewed customer sees the new visit only");
      assert.equal(Number(payload.posOrders[0].orderId), nextVisitOrderId);
      assert.notEqual(nextVisitOrderId, firstVisitOrderId);
    }
    const rescan = await fetch(`${origin}/tdkqrs/${qr.identifier}`, {
      headers: { cookie: renewedCookies[0] }, redirect: "manual", signal: AbortSignal.timeout(15000),
    });
    assert.equal(new URL(rescan.headers.get("location"), origin).pathname, "/qrorder");
    assert.equal(rescan.headers.get("set-cookie"), null, "rescan keeps the current-visit customer token");
    const [[afterRescan]] = await connection.query(
      "SELECT COUNT(*) AS count FROM qr_sessions WHERE table_id = ? AND status = 'ACTIVE'", [tableId],
    );
    assert.equal(Number(afterRescan.count), 2, "rescan does not issue a third customer session");

    const [secondTable] = await connection.query(
      "INSERT INTO dining_tables (table_no, capacity, is_active) VALUES (?, 4, 1)", [secondMarker],
    );
    secondTableId = Number(secondTable.insertId);
    const secondIdentifier = identifier();
    const [secondCode] = await connection.query(
      "INSERT INTO qr_codes (identifier, management_number, target_type, status, created_by_staff_id) VALUES (?, ?, 'TABLE_ORDER', 'IN_USE', ?)",
      [secondIdentifier, secondMarker, staff.staff_id],
    );
    secondQrCodeId = Number(secondCode.insertId);
    await connection.query("INSERT INTO qr_table_links (qr_code_id, table_id, assigned_by_staff_id) VALUES (?, ?, ?)",
      [secondQrCodeId, secondTableId, staff.staff_id]);

    const scanSecond = (priorCookie) => fetch(`${origin}/tdkqrs/${secondIdentifier}`, {
      headers: priorCookie ? { cookie: priorCookie } : {}, redirect: "manual", signal: AbortSignal.timeout(15000),
    });
    const destinationOf = response => new URL(response.headers.get("location"), origin).pathname;
    const orderHistory = async sessionCookie => {
      const response = await fetch(`${origin}/api/qr/table-orders`, {
        headers: { cookie: sessionCookie, origin }, signal: AbortSignal.timeout(15000),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const freshScan = await scanSecond();
    assert.equal(destinationOf(freshScan), "/qrorder/order", "a fresh browser can scan the empty second table");
    const representativeCookie = freshScan.headers.get("set-cookie")?.split(";", 1)[0];
    assert.match(representativeCookie ?? "", /^tdkon_qr_session=/);

    const switchedEmpty = await scanSecond(renewedCookies[0]);
    assert.equal(switchedEmpty.status, 302);
    assert.equal(destinationOf(switchedEmpty), "/qrorder/order", "an active first-table cookie permits entry to the empty second table");
    const newCookie = switchedEmpty.headers.get("set-cookie")?.split(";", 1)[0];
    assert.match(newCookie ?? "", /^tdkon_qr_session=/);
    assert.notEqual(newCookie, renewedCookies[0]);
    const emptyHistory = await orderHistory(newCookie);
    assert.equal(emptyHistory.tableNo, secondMarker);
    assert.equal(emptyHistory.canViewOrders, false);
    assert.equal(emptyHistory.posOrders.length, 0);
    assert.equal(emptyHistory.ownRequests.length, 0);

    const [secondVisit] = await connection.query(
      "INSERT INTO table_sessions (table_id, opened_by_staff_id, session_kind, status) VALUES (?, ?, 'DINE_IN', 'OPEN')",
      [secondTableId, staff.staff_id],
    );
    secondVisitId = Number(secondVisit.insertId);
    const [secondOrder] = await connection.query(
      "INSERT INTO orders (session_id, order_type, status, subtotal_amount, discount_amount, total_amount, created_by_staff_id) VALUES (?, 'POS', 'ACCEPTED', 9000, 0, 9000, ?)",
      [secondVisitId, staff.staff_id],
    );
    secondOrderId = Number(secondOrder.insertId);
    const repHash = createHash("sha256").update(decodeURIComponent(representativeCookie.split("=")[1])).digest("hex");
    const [[representative]] = await connection.query("SELECT qr_session_id FROM qr_sessions WHERE token_hash = ?", [repHash]);
    assert.ok(representative, "the fresh browser session can represent the populated visit");
    const [repOrder] = await connection.query(
      "INSERT INTO qr_orders (qr_session_id, status, subtotal_amount, total_amount, accepted_order_id) VALUES (?, 'ACCEPTED', 9000, 9000, ?)",
      [representative.qr_session_id, secondOrderId],
    );
    await connection.query(
      "UPDATE qr_sessions SET session_id = ?, access_grant_source = 'ORDER_APPROVED', access_grant_qr_order_id = ?, access_granted_at = CURRENT_TIMESTAMP WHERE qr_session_id = ?",
      [secondVisitId, repOrder.insertId, representative.qr_session_id],
    );
    await connection.query(
      "INSERT INTO qr_table_order_claims (table_id, representative_qr_session_id, first_qr_order_id, table_session_id, state, confirmed_at) VALUES (?, ?, ?, ?, 'CONFIRMED', CURRENT_TIMESTAMP)",
      [secondTableId, representative.qr_session_id, repOrder.insertId, secondVisitId],
    );

    const switchedPopulated = await scanSecond(renewedCookies[1]);
    assert.equal(destinationOf(switchedPopulated), "/qrorder", "the other browser can open the populated visit with a confirmed representative");
    const populatedCookie = switchedPopulated.headers.get("set-cookie")?.split(";", 1)[0];
    assert.match(populatedCookie ?? "", /^tdkon_qr_session=/);
    assert.notEqual(populatedCookie, renewedCookies[1]);
    const secondHistory = await orderHistory(populatedCookie);
    assert.equal(secondHistory.tableNo, secondMarker);
    assert.equal(secondHistory.canViewCurrentVisitOrders, true);
    assert.equal(secondHistory.canViewOrders, false, "switching does not grant representative access");
    assert.equal(secondHistory.ownRequests.length, 0, "new cookie cannot inherit another customer's requests");
    const visibleSecondIds = [
      ...secondHistory.posOrders.map(order => Number(order.orderId)),
      ...secondHistory.orders.map(order => Number(order.acceptedOrderId)),
    ];
    assert.ok(visibleSecondIds.includes(secondOrderId));
    assert.ok(!visibleSecondIds.includes(nextVisitOrderId), "previous table history never follows the new cookie");
    const priorHistory = await orderHistory(renewedCookies[1]);
    assert.equal(priorHistory.tableNo, marker, "the first table session stays independent");
    assert.equal(Number(priorHistory.posOrders[0].orderId), nextVisitOrderId);
    const [[claimAfterSwitch]] = await connection.query(
      "SELECT representative_qr_session_id, state FROM qr_table_order_claims WHERE table_id = ?", [secondTableId],
    );
    assert.equal(Number(claimAfterSwitch.representative_qr_session_id), Number(representative.qr_session_id));
    assert.equal(claimAfterSwitch.state, "CONFIRMED");
    const sameTableScan = await scanSecond(populatedCookie);
    assert.equal(destinationOf(sameTableScan), "/qrorder");
    assert.equal(sameTableScan.headers.get("set-cookie"), null);

    const requireUnavailable = async () => {
      const response = await scanSecond(renewedCookies[0]);
      assert.equal(destinationOf(response), "/qrorder/unavailable");
      assert.equal(response.headers.get("set-cookie"), null, "an invalid target cannot replace a valid cookie");
    };
    for (const status of ["LOCKED", "RETIRED"]) {
      await connection.query("UPDATE qr_codes SET status = ? WHERE qr_code_id = ?", [status, secondQrCodeId]);
      await requireUnavailable();
    }
    await connection.query("UPDATE qr_codes SET status = 'IN_USE' WHERE qr_code_id = ?", [secondQrCodeId]);
    await connection.query("UPDATE dining_tables SET is_active = 0 WHERE table_id = ?", [secondTableId]);
    await requireUnavailable();
    await connection.query("UPDATE dining_tables SET is_active = 1 WHERE table_id = ?", [secondTableId]);
    await connection.query("DELETE FROM qr_table_links WHERE qr_code_id = ?", [secondQrCodeId]);
    await requireUnavailable();
    console.log("PASS: QR entry, concurrent scans, current-visit history, prior-visit isolation, token reuse, switching tables, representative isolation and disabled targets");
  } finally {
    if (server) {
      server.kill();
      await Promise.race([new Promise(resolve => server.once("exit", resolve)), wait(5000)]);
    }
    // Access-log writes have a bounded 250 ms timeout and may finish after response.
    await wait(500);
    if (tableId !== undefined || qrCodeId !== undefined) {
      await connection.beginTransaction();
      try {
        if (qrCodeId !== undefined) await connection.query("DELETE FROM audit_logs WHERE entity_type = 'QR_CODE' AND entity_id = ?", [qrCodeId]);
        if (tableId !== undefined) {
          const sessionIds = [tableSessionId, nextTableSessionId].filter(id => id !== undefined);
          if (sessionIds.length) await connection.query("DELETE FROM order_items WHERE order_id IN (SELECT order_id FROM orders WHERE session_id IN (?))", [sessionIds]);
          if (sessionIds.length) await connection.query("DELETE FROM orders WHERE session_id IN (?)", [sessionIds]);
          await connection.query("DELETE FROM qr_order_item_options WHERE qr_order_item_id IN (SELECT item.qr_order_item_id FROM qr_order_items item JOIN qr_orders ord ON ord.qr_order_id = item.qr_order_id JOIN qr_sessions sess ON sess.qr_session_id = ord.qr_session_id WHERE sess.table_id = ?)", [tableId]);
          await connection.query("DELETE FROM qr_order_items WHERE qr_order_id IN (SELECT ord.qr_order_id FROM qr_orders ord JOIN qr_sessions sess ON sess.qr_session_id = ord.qr_session_id WHERE sess.table_id = ?)", [tableId]);
          await connection.query("DELETE FROM qr_orders WHERE qr_session_id IN (SELECT qr_session_id FROM qr_sessions WHERE table_id = ?)", [tableId]);
          await connection.query("DELETE FROM qr_session_invites WHERE session_id IN (SELECT session_id FROM table_sessions WHERE table_id = ?)", [tableId]);
        }
        if (tableId !== undefined) await connection.query("DELETE FROM qr_sessions WHERE table_id = ?", [tableId]);
        if (tableSessionId !== undefined) await connection.query("DELETE FROM table_sessions WHERE session_id = ?", [tableSessionId]);
        if (nextTableSessionId !== undefined) await connection.query("DELETE FROM table_sessions WHERE session_id = ?", [nextTableSessionId]);
        if (qrCodeId !== undefined) await connection.query("DELETE FROM qr_table_links WHERE qr_code_id = ?", [qrCodeId]);
        if (qrCodeId !== undefined) await connection.query("DELETE FROM qr_codes WHERE qr_code_id = ?", [qrCodeId]);
        if (tableId !== undefined) await connection.query("DELETE FROM dining_tables WHERE table_id = ?", [tableId]);
        if (secondTableId !== undefined) {
          await connection.query("DELETE FROM qr_table_order_claims WHERE table_id = ?", [secondTableId]);
          await connection.query("DELETE FROM qr_orders WHERE qr_session_id IN (SELECT qr_session_id FROM qr_sessions WHERE table_id = ?)", [secondTableId]);
          await connection.query("DELETE FROM qr_sessions WHERE table_id = ?", [secondTableId]);
        }
        if (secondOrderId !== undefined) await connection.query("DELETE FROM orders WHERE order_id = ?", [secondOrderId]);
        if (secondVisitId !== undefined) await connection.query("DELETE FROM table_sessions WHERE session_id = ?", [secondVisitId]);
        if (secondQrCodeId !== undefined) {
          await connection.query("DELETE FROM audit_logs WHERE entity_type = 'QR_CODE' AND entity_id = ?", [secondQrCodeId]);
          await connection.query("DELETE FROM qr_table_links WHERE qr_code_id = ?", [secondQrCodeId]);
          await connection.query("DELETE FROM qr_codes WHERE qr_code_id = ?", [secondQrCodeId]);
        }
        if (secondTableId !== undefined) await connection.query("DELETE FROM dining_tables WHERE table_id = ?", [secondTableId]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
    const [[remaining]] = await connection.query("SELECT COUNT(*) AS count FROM dining_tables WHERE table_no IN (?, ?)", [marker, secondMarker]);
    assert.equal(Number(remaining.count), 0, "development fixture was removed");
    await connection.end();
  }
}

main().catch(error => {
  console.error("QR entry development verification failed", { code: error.code, message: error.message });
  process.exitCode = 1;
});
