/* eslint-disable @typescript-eslint/no-require-imports -- This standalone test runner is CommonJS. */
// Development-only HTTP integration check with uniquely named fixtures.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomInt, randomUUID } = require("node:crypto");
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
  const marker = `ZZQR${randomUUID().replaceAll("-", "").slice(0, 12)}`;
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

    const entry = await fetch(`${origin}/q/${qr.identifier}`, { redirect: "manual", signal: AbortSignal.timeout(15000) });
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
    const submitted = await fetch(`${origin}/api/qr/table-orders`, {
      method: "POST", headers: { cookie, origin, "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: randomUUID(), cart: [{ menuId: menu.menuId, qty: 1, options }] }),
      signal: AbortSignal.timeout(15000),
    });
    const submission = await submitted.json();
    assert.ok([200, 201].includes(submitted.status), `QR order submission failed: HTTP ${submitted.status} ${submission.message ?? submission.code ?? "unknown"}`);
    assert.equal(submission.success, true);
    const [savedOrders] = await connection.query(
      "SELECT qr_order_id, status FROM qr_orders WHERE qr_session_id = ?", [issued[0].qr_session_id],
    );
    assert.equal(savedOrders.length, 1);
    assert.equal(savedOrders[0].status, "PENDING");

    await connection.query("UPDATE qr_orders SET status = 'REJECTED' WHERE qr_order_id = ?", [savedOrders[0].qr_order_id]);

    await connection.query("UPDATE qr_sessions SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP WHERE qr_session_id = ?", [issued[0].qr_session_id]);
    const afterClose = await fetch(`${origin}/api/qr/table-orders`, {
      headers: { cookie, origin }, signal: AbortSignal.timeout(15000),
    });
    assert.ok([401, 409].includes(afterClose.status), "closed session cannot read orders");
    console.log("PASS: QR entry, table binding, HttpOnly cookie, order page, QR order submission, closed-session rejection");
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
          await connection.query("DELETE FROM qr_order_item_options WHERE qr_order_item_id IN (SELECT item.qr_order_item_id FROM qr_order_items item JOIN qr_orders ord ON ord.qr_order_id = item.qr_order_id JOIN qr_sessions sess ON sess.qr_session_id = ord.qr_session_id WHERE sess.table_id = ?)", [tableId]);
          await connection.query("DELETE FROM qr_order_items WHERE qr_order_id IN (SELECT ord.qr_order_id FROM qr_orders ord JOIN qr_sessions sess ON sess.qr_session_id = ord.qr_session_id WHERE sess.table_id = ?)", [tableId]);
          await connection.query("DELETE FROM qr_orders WHERE qr_session_id IN (SELECT qr_session_id FROM qr_sessions WHERE table_id = ?)", [tableId]);
        }
        if (tableId !== undefined) await connection.query("DELETE FROM qr_sessions WHERE table_id = ?", [tableId]);
        if (qrCodeId !== undefined) await connection.query("DELETE FROM qr_table_links WHERE qr_code_id = ?", [qrCodeId]);
        if (qrCodeId !== undefined) await connection.query("DELETE FROM qr_codes WHERE qr_code_id = ?", [qrCodeId]);
        if (tableId !== undefined) await connection.query("DELETE FROM dining_tables WHERE table_id = ?", [tableId]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
    const [[remaining]] = await connection.query("SELECT COUNT(*) AS count FROM dining_tables WHERE table_no = ?", [marker]);
    assert.equal(Number(remaining.count), 0, "development fixture was removed");
    await connection.end();
  }
}

main().catch(error => {
  console.error("QR entry development verification failed", { code: error.code, message: error.message });
  process.exitCode = 1;
});
