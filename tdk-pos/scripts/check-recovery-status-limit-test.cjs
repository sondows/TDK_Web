/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash } = require("node:crypto");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

async function main() {
  if (process.env.DB_NAME !== "TDK_POS_TEST") throw new Error("Only TDK_POS_TEST is allowed");
  const db = await mysql.createConnection({ host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  try {
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "unverified"]) {
      const key = createHash("sha256").update(`master-recovery-status:ip:${ip}`).digest("hex");
      const [rows] = await db.execute("SELECT attempt_count,window_started_at>DATE_SUB(NOW(),INTERVAL 15 MINUTE) AS recent " +
        "FROM admin_auth_attempts WHERE attempt_key=?", [key]);
      if (rows.length) process.stdout.write(JSON.stringify({ client: ip,
        attempts: Number(rows[0].attempt_count), recent: Boolean(rows[0].recent) }) + "\n");
    }
  } finally { await db.end(); }
}
main().catch(error => { console.error("Recovery status limit check failed", { code: error.code ?? error.name });
  process.exitCode = 1; });
