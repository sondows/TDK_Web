/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

async function main() {
  if (process.env.DB_NAME !== "TDK_POS_TEST") throw new Error("Refusing a non-test database");
  const sql = fs.readFileSync(path.join(__dirname, "../db-migrations/20261029_program_trust_test.sql"), "utf8");
  if (!sql.includes("USE TDK_POS_TEST;") || sql.includes("USE TDK_POS;")) throw new Error("Unexpected SQL target");
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, multipleStatements: true,
  });
  try {
    const [before] = await connection.query("SELECT COUNT(*) AS count FROM staff");
    await connection.query(sql);
    const [after] = await connection.query("SELECT COUNT(*) AS count FROM staff");
    if (Number(before[0].count) !== Number(after[0].count)) throw new Error("Staff row count changed");
    process.stdout.write("TDK_POS_TEST additive migration applied; staff rows preserved: " + after[0].count + "\n");
  } finally { await connection.end(); }
}
main().catch(error => { console.error("Test DB migration failed", { code: error.code ?? error.name }); process.exitCode = 1; });
