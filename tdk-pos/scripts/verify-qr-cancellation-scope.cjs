/* eslint-disable @typescript-eslint/no-require-imports -- This standalone test runner is CommonJS. */
// Development-only transaction test. All fixture rows are rolled back.
const assert = require("node:assert/strict");
const { randomBytes, randomUUID } = require("node:crypto");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: "TDK_POS_TEST",
    connectTimeout: 7000,
  });
  const marker = `ZZQR${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let transactionOpen = false;
  try {
    const [[identity]] = await connection.query("SELECT DATABASE() AS name");
    assert.equal(identity.name, "TDK_POS_TEST");
    await connection.beginTransaction();
    transactionOpen = true;

    const tableIds = [];
    const sessionIds = [];
    for (const suffix of ["A", "B", "C"]) {
      const [table] = await connection.query(
        "INSERT INTO dining_tables (table_no, table_name, capacity, is_active) VALUES (?, ?, 4, 1)",
        [`${marker}${suffix}`, `QR cancellation fixture ${suffix}`],
      );
      tableIds.push(Number(table.insertId));
      const [session] = await connection.query(
        "INSERT INTO table_sessions (table_id, status, session_kind) VALUES (?, 'OPEN', 'DINE_IN')",
        [table.insertId],
      );
      sessionIds.push(Number(session.insertId));
    }

    const qrIds = [];
    for (const [sessionId, tableId] of [
      [null, tableIds[0]], // QR issued before a table session
      [sessionIds[0], tableIds[0]], // bound customer
      [sessionIds[0], tableIds[0]], // second/guest customer
      [null, tableIds[1]], // unrelated table
    ]) {
      const [qr] = await connection.query(
        "INSERT INTO qr_sessions (session_id, table_id, token_hash, status) VALUES (?, ?, ?, 'ACTIVE')",
        [sessionId, tableId, randomBytes(32).toString("hex")],
      );
      qrIds.push(Number(qr.insertId));
    }
    const [pending] = await connection.query(
      "INSERT INTO qr_orders (qr_session_id, status) VALUES (?, 'PENDING')", [qrIds[0]],
    );
    const [pendingRows] = await connection.query(
      "SELECT qr_order_id FROM qr_orders WHERE status = 'PENDING' AND qr_session_id IN (?, ?, ?)",
      qrIds.slice(0, 3),
    );
    assert.equal(pendingRows.length, 1, "pending order blocks cancellation");
    await connection.query("UPDATE qr_orders SET status = 'REJECTED' WHERE qr_order_id = ?", [pending.insertId]);

    const [selected] = await connection.query(
      "SELECT qr_session_id FROM qr_sessions WHERE session_id IN (?) OR table_id IN (?) ORDER BY qr_session_id",
      [sessionIds[0], tableIds[0]],
    );
    assert.deepEqual(selected.map(row => Number(row.qr_session_id)), qrIds.slice(0, 3));
    const [cancelled] = await connection.query(
      "UPDATE qr_sessions SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP WHERE (session_id IN (?) OR table_id IN (?)) AND status = 'ACTIVE'",
      [sessionIds[0], tableIds[0]],
    );
    assert.equal(cancelled.affectedRows, 3);
    const [unrelated] = await connection.query("SELECT status FROM qr_sessions WHERE qr_session_id = ?", [qrIds[3]]);
    assert.equal(unrelated[0].status, "ACTIVE", "other table remains active");
    const [emptyTable] = await connection.query(
      "UPDATE qr_sessions SET status = 'CLOSED' WHERE (session_id IN (?) OR table_id IN (?)) AND status = 'ACTIVE'",
      [sessionIds[2], tableIds[2]],
    );
    assert.equal(emptyTable.affectedRows, 0, "table without QR sessions is safe");
    const [repeat] = await connection.query(
      "UPDATE qr_sessions SET status = 'CLOSED' WHERE (session_id IN (?) OR table_id IN (?)) AND status = 'ACTIVE'",
      [sessionIds[0], tableIds[0]],
    );
    assert.equal(repeat.affectedRows, 0, "repeat closure is idempotent");

    await connection.query("SAVEPOINT simulated_cancel_failure");
    await connection.query("UPDATE qr_sessions SET status = 'CLOSED' WHERE qr_session_id = ?", [qrIds[3]]);
    await connection.query("ROLLBACK TO SAVEPOINT simulated_cancel_failure");
    const [restored] = await connection.query("SELECT status FROM qr_sessions WHERE qr_session_id = ?", [qrIds[3]]);
    assert.equal(restored[0].status, "ACTIVE", "failed transaction restores its changes");

    console.log("PASS: pending guard, bound/unbound/guest QR scope, unrelated table, empty table, repeat, savepoint rollback");
  } finally {
    if (transactionOpen) await connection.rollback();
    const [remaining] = await connection.query("SELECT COUNT(*) AS count FROM dining_tables WHERE table_no LIKE ?", [`${marker}%`]);
    assert.equal(Number(remaining[0].count), 0, "all development fixtures rolled back");
    await connection.end();
  }
}

main().catch(error => {
  console.error("QR cancellation scope verification failed", { code: error.code, message: error.message });
  process.exitCode = 1;
});
