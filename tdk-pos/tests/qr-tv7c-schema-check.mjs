import assert from "node:assert/strict";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local", quiet: true });
assert.equal(process.env.DB_NAME, "TDK_POS_TEST", "TEST DB only");
const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: "TDK_POS_TEST" });
try {
  const [[database]] = await connection.query("SELECT DATABASE() AS name");
  assert.equal(database.name, "TDK_POS_TEST");
  for (const table of ["qr_table_order_claims", "qr_order_auth_attempts"]) {
    const [ddl] = await connection.query(`SHOW CREATE TABLE ${table}`);
    assert.equal(ddl.length, 1, `${table} must exist`);
    const [columns] = await connection.query(`SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`, [table]);
    const [indexes] = await connection.query(`SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`, [table]);
    const [foreignKeys] = await connection.query(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL`, [table]);
    const [[count]] = await connection.query(`SELECT COUNT(*) AS n FROM ${table}`);
    console.log(`${table}: columns=${columns.length}, indexes=${indexes.length}, foreignKeys=${foreignKeys.length}, rows=${count.n}`);
    if (table === "qr_order_auth_attempts") {
      const snapshot = columns.find(row => row.COLUMN_NAME === "table_session_id_at_auth");
      const recorded = columns.find(row => row.COLUMN_NAME === "session_snapshot_recorded");
      assert.match(snapshot?.COLUMN_TYPE ?? "", /^bigint\(\d+\) unsigned$/);
      assert.equal(snapshot.IS_NULLABLE, "YES");
      assert.ok(snapshot.COLUMN_DEFAULT === null || snapshot.COLUMN_DEFAULT === "NULL");
      assert.match(recorded?.COLUMN_TYPE ?? "", /^tinyint\(\d+\) unsigned$/);
      assert.equal(recorded.IS_NULLABLE, "NO");
      assert.equal(String(recorded.COLUMN_DEFAULT), "0");
      console.log("TV-7C snapshot columns: PASS");
    }
  }
} finally { await connection.end(); }
