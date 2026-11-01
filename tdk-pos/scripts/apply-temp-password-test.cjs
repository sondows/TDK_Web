/* eslint-disable @typescript-eslint/no-require-imports */
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

async function main() {
  if (process.env.DB_NAME !== "TDK_POS_TEST") throw new Error("Only TDK_POS_TEST is allowed");
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  try {
    const [before] = await db.execute("SELECT COUNT(*) AS n FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='staff' AND COLUMN_NAME='security_password_change_required'");
    if (Number(before[0].n) === 0) {
      await db.query("ALTER TABLE staff ADD COLUMN security_password_change_required TINYINT NOT NULL DEFAULT 0 AFTER security_password_hash");
    }
    const [after] = await db.execute("SELECT COUNT(*) AS n FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='staff' AND COLUMN_NAME='security_password_change_required'");
    if (Number(after[0].n) !== 1) throw new Error("Test column missing after migration");
    process.stdout.write(JSON.stringify({ db: "TDK_POS_TEST", columnReady: true, alreadyPresent: Number(before[0].n) === 1 }) + "\n");
  } finally { await db.end(); }
}
main().catch(error => { console.error("Test migration unavailable", { code: error.code ?? error.name });
  process.exitCode = 1; });
