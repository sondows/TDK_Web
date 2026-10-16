// Validates the migration against a disposable TEMPORARY TABLE in TDK_POS_TEST.
// It never alters table_sessions or its existing rows.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local"), quiet: true });
if (process.env.DB_NAME !== "TDK_POS_TEST") throw new Error("TDK_POS_TEST only");
const mysql = require("mysql2/promise");

(async () => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 10000,
  });
  try {
    const [before] = await connection.query("SELECT COUNT(*) AS count FROM table_sessions");
    await connection.query("CREATE TEMPORARY TABLE takeout_schema_probe LIKE table_sessions");
    const [present] = await connection.query("SHOW COLUMNS FROM takeout_schema_probe LIKE 'session_kind'");
    if (!present.length) {
      const migration = fs.readFileSync(path.join(__dirname, "..", "db-migrations", "20261015_takeout_sessions.sql"), "utf8")
        .replace(/--[^\n]*\n/g, "")
        .replace("ALTER TABLE table_sessions", "ALTER TABLE takeout_schema_probe")
        .trim();
      await connection.query(migration);
    }
    const [columns] = await connection.query("SHOW COLUMNS FROM takeout_schema_probe");
    const names = new Set(columns.map(column => column.Field));
    for (const name of ["session_kind", "display_name", "takeout_label_key", "create_request_key", "pickup_name", "pickup_phone", "pickup_at"])
      assert(names.has(name), `missing ${name}`);
    assert.equal(columns.find(column => column.Field === "table_id")?.Null, "YES");
    await connection.query("INSERT INTO takeout_schema_probe (table_id, session_kind, display_name, takeout_label_key, create_request_key) VALUES (NULL, 'TAKEOUT_WALK_IN', '방문포장0739', '20261015:W:0739:1', '00000000-0000-4000-8000-000000000001')");
    let duplicateRejected = false;
    try {
      await connection.query("INSERT INTO takeout_schema_probe (table_id, session_kind, display_name, takeout_label_key, create_request_key) VALUES (NULL, 'TAKEOUT_WALK_IN', '방문포장0739', '20261015:W:0739:1', '00000000-0000-4000-8000-000000000002')");
    } catch (error) { duplicateRejected = error.code === "ER_DUP_ENTRY"; }
    assert(duplicateRejected, "same-minute sequence must be unique");
    const [after] = await connection.query("SELECT COUNT(*) AS count FROM table_sessions");
    assert.equal(after[0].count, before[0].count);
    console.log(JSON.stringify({ database: "TDK_POS_TEST", migration: "temporary-table pass", originalRows: after[0].count, duplicateRejected }));
  } finally {
    await connection.end();
  }
})().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
