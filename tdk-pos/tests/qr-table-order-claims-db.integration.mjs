import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local", quiet: true });
assert.equal(process.env.DB_NAME, "TDK_POS_TEST", "Development DB only");
const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const tag = randomBytes(8).toString("hex");
let tableId = null;
let sessionId = null;
let firstOrderId = null;
let otherSessionId = null;
try {
  const [[selected]] = await db.query("SELECT DATABASE() AS name");
  assert.equal(selected.name, "TDK_POS_TEST");
  const [types] = await db.query(`SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='dining_tables' AND COLUMN_NAME='table_id')
    OR (TABLE_NAME='qr_sessions' AND COLUMN_NAME='qr_session_id')
    OR (TABLE_NAME='qr_orders' AND COLUMN_NAME='qr_order_id')
    OR (TABLE_NAME='table_sessions' AND COLUMN_NAME='session_id'))`);
  assert.equal(types.length, 4);
  assert.ok(types.every(row => row.COLUMN_TYPE.toLowerCase() === "bigint(20) unsigned" || row.COLUMN_TYPE.toLowerCase() === "bigint unsigned"), JSON.stringify(types));
  const [[exists]] = await db.query(`SELECT COUNT(*) AS n FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='qr_table_order_claims'`);
  if (!Number(exists.n)) {
    if (!process.argv.includes("--apply-schema")) throw Error("Claim table absent; run with --apply-schema after review");
    const ddl = (await readFile(new URL("../db-migrations/20261125_qr_table_order_claims_test.sql", import.meta.url), "utf8"))
      .split("\n").filter(line => !line.trim().startsWith("--")).join("\n").trim();
    await db.query(ddl);
    console.log("Development claim table created");
  }
  const [columns] = await db.query(`SELECT COLUMN_NAME,IS_NULLABLE,COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='qr_table_order_claims' ORDER BY ORDINAL_POSITION`);
  assert.deepEqual(columns.map(row => row.COLUMN_NAME), ["table_id", "representative_qr_session_id", "first_qr_order_id", "table_session_id", "state", "claimed_at", "confirmed_at"]);
  assert.equal(columns.find(row => row.COLUMN_NAME === "table_session_id")?.IS_NULLABLE, "YES");
  const [keys] = await db.query(`SELECT CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='qr_table_order_claims'`);
  assert.equal(keys.filter(row => row.CONSTRAINT_TYPE === "PRIMARY KEY").length, 1);
  assert.equal(keys.filter(row => row.CONSTRAINT_TYPE === "FOREIGN KEY").length, 4);
  console.log("PASS: development database, column types, claim table, primary key and foreign keys");

  tableId = Number((await db.query("INSERT INTO dining_tables (table_no,capacity,is_active) VALUES (?,8,1)", [`ZZC${tag}`]))[0].insertId);
  sessionId = Number((await db.query("INSERT INTO qr_sessions (table_id,token_hash,status) VALUES (?,?,'ACTIVE')", [tableId, randomBytes(32).toString("hex")]))[0].insertId);
  otherSessionId = Number((await db.query("INSERT INTO qr_sessions (table_id,token_hash,status) VALUES (?,?,'ACTIVE')", [tableId, randomBytes(32).toString("hex")]))[0].insertId);
  firstOrderId = Number((await db.query("INSERT INTO qr_orders (qr_session_id,status) VALUES (?,'PENDING')", [sessionId]))[0].insertId);
  await db.query("INSERT INTO qr_table_order_claims (table_id,representative_qr_session_id,first_qr_order_id) VALUES (?,?,?)", [tableId, sessionId, firstOrderId]);
  await assert.rejects(db.query("INSERT INTO qr_table_order_claims (table_id,representative_qr_session_id,first_qr_order_id) VALUES (?,?,?)", [tableId, otherSessionId, firstOrderId]), error => error.code === "ER_DUP_ENTRY");
  const [[claim]] = await db.query("SELECT state,representative_qr_session_id,table_session_id FROM qr_table_order_claims WHERE table_id=?", [tableId]);
  assert.equal(claim.state, "PENDING");
  assert.equal(Number(claim.representative_qr_session_id), sessionId);
  assert.equal(claim.table_session_id, null);
  console.log("PASS: isolated claim creation and duplicate prevention");
} finally {
  if (tableId !== null) await db.query("DELETE FROM qr_table_order_claims WHERE table_id=?", [tableId]);
  if (firstOrderId !== null) await db.query("DELETE FROM qr_orders WHERE qr_order_id=?", [firstOrderId]);
  if (sessionId !== null) await db.query("DELETE FROM qr_sessions WHERE qr_session_id=?", [sessionId]);
  if (otherSessionId !== null) await db.query("DELETE FROM qr_sessions WHERE qr_session_id=?", [otherSessionId]);
  if (tableId !== null) await db.query("DELETE FROM dining_tables WHERE table_id=? AND table_no=?", [tableId, `ZZC${tag}`]);
  await db.end();
}
