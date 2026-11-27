import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local", quiet: true });
assert.equal(process.env.DB_NAME, "TDK_POS_TEST", "Development DB only");
const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: "TDK_POS_TEST" });
const requestId = randomUUID();
const tableNo = `ZZQ${randomBytes(7).toString("hex")}`;
let tableId = null;
let qrSessionId = null;
try {
  const [[selected]] = await db.query("SELECT DATABASE() AS name");
  assert.equal(selected.name, "TDK_POS_TEST");
  const [columns] = await db.query(`SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='qr_order_auth_attempts'
    ORDER BY ORDINAL_POSITION`);
  assert.deepEqual(columns.map(row => row.COLUMN_NAME), ["attempt_id", "qr_session_id", "table_id", "table_session_id_at_auth", "session_snapshot_recorded", "client_request_id", "issuance_id", "code",
    "cart_fingerprint", "state", "failed_attempts", "created_at", "expires_at", "verified_at", "consumed_at", "qr_order_id"]);
  const [keys] = await db.query(`SELECT CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='qr_order_auth_attempts'`);
  assert.equal(keys.filter(row => row.CONSTRAINT_TYPE === "PRIMARY KEY").length, 1);
  assert.equal(keys.filter(row => row.CONSTRAINT_TYPE === "UNIQUE").length, 1);
  assert.equal(keys.filter(row => row.CONSTRAINT_TYPE === "FOREIGN KEY").length, 3);

  await db.beginTransaction();
  tableId = Number((await db.query("INSERT INTO dining_tables (table_no,capacity,is_active) VALUES (?,8,1)", [tableNo]))[0].insertId);
  qrSessionId = Number((await db.query("INSERT INTO qr_sessions (table_id,token_hash,status) VALUES (?,?,'ACTIVE')",
    [tableId, randomBytes(32).toString("hex")]))[0].insertId);
  const attemptId = randomUUID();
  const issuanceId = randomUUID();
  const fingerprint = "a".repeat(64);
  await db.query(`INSERT INTO qr_order_auth_attempts
    (attempt_id,qr_session_id,table_id,client_request_id,issuance_id,code,cart_fingerprint,state,expires_at)
    VALUES (?,?,?,?,?,? ,?,'PENDING',DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 2 MINUTE))`,
    [attemptId, qrSessionId, tableId, requestId, issuanceId, "03", fingerprint]);
  await assert.rejects(db.query(`INSERT INTO qr_order_auth_attempts
    (attempt_id,qr_session_id,table_id,client_request_id,issuance_id,code,cart_fingerprint,state,expires_at)
    VALUES (?,?,?,?,?,? ,?,'PENDING',DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 2 MINUTE))`,
    [randomUUID(), qrSessionId, tableId, requestId, issuanceId, "03", fingerprint]), error => error.code === "ER_DUP_ENTRY");
  await db.query("UPDATE qr_order_auth_attempts SET failed_attempts=1 WHERE attempt_id=?", [attemptId]);
  await db.query("UPDATE qr_order_auth_attempts SET failed_attempts=2 WHERE attempt_id=?", [attemptId]);
  await db.query("UPDATE qr_order_auth_attempts SET failed_attempts=3,state='BLOCKED' WHERE attempt_id=?", [attemptId]);
  const [[attempt]] = await db.query("SELECT state,failed_attempts,code,issuance_id,cart_fingerprint FROM qr_order_auth_attempts WHERE attempt_id=?", [attemptId]);
  assert.equal(attempt.state, "BLOCKED");
  assert.equal(Number(attempt.failed_attempts), 3);
  assert.equal(attempt.code, "03");
  assert.equal(attempt.issuance_id, issuanceId);
  assert.equal(attempt.cart_fingerprint, fingerprint);
  const [deleted] = await db.query("DELETE FROM qr_order_auth_attempts WHERE attempt_id=?", [attemptId]);
  assert.equal(deleted.affectedRows, 1);
  await db.rollback();
  const [[remaining]] = await db.query("SELECT COUNT(*) AS row_count FROM qr_order_auth_attempts WHERE client_request_id=?", [requestId]);
  assert.equal(Number(remaining.row_count), 0);
  const [[tableRemaining]] = await db.query("SELECT COUNT(*) AS row_count FROM dining_tables WHERE table_no=?", [tableNo]);
  assert.equal(Number(tableRemaining.row_count), 0);
  tableId = null; qrSessionId = null;
  console.log("PASS: TEST schema, unique idempotency, leading-zero code, three-failure state, CRUD privileges, and rollback cleanup");
} catch (error) {
  try { await db.rollback(); } catch { /* no open transaction */ }
  throw error;
} finally {
  await db.end();
}
