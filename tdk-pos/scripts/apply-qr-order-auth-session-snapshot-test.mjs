import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local", quiet: true });
if (process.env.DB_NAME !== "TDK_POS_TEST") throw new Error("This migration is restricted to TDK_POS_TEST");
const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: "TDK_POS_TEST" });
try {
  const [[selected]] = await connection.query("SELECT DATABASE() AS databaseName");
  if (selected.databaseName !== "TDK_POS_TEST") throw new Error("Unexpected database connection");
  await connection.query(`ALTER TABLE qr_order_auth_attempts
    ADD COLUMN IF NOT EXISTS table_session_id_at_auth BIGINT UNSIGNED NULL AFTER table_id,
    ADD COLUMN IF NOT EXISTS session_snapshot_recorded TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER table_session_id_at_auth`);
  const [columns] = await connection.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='qr_order_auth_attempts'
      AND COLUMN_NAME IN ('table_session_id_at_auth','session_snapshot_recorded')`);
  if (columns.length !== 2) throw new Error("Migration columns were not found");
  console.log("TDK_POS_TEST QR auth session snapshot migration: PASS");
} finally { await connection.end(); }
