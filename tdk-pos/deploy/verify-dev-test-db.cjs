/* Read-only guard: refuse all databases other than TDK_POS_TEST. */
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());

async function main() {
  if (process.env.DB_NAME !== "TDK_POS_TEST") {
    throw new Error("Refusing DB connection: DB_NAME must be exactly TDK_POS_TEST.");
  }
  const mysql = require("mysql2/promise");
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: "TDK_POS_TEST",
    connectTimeout: 5000,
  });
  try {
    const [rows] = await connection.query("SELECT DATABASE() AS actual_database");
    if (rows[0]?.actual_database !== "TDK_POS_TEST") {
      throw new Error("Connected database did not match TDK_POS_TEST; refusing to continue.");
    }
    console.log("Read-only DB preflight: TDK_POS_TEST confirmed.");
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(`Read-only DB preflight failed: ${error.message}`);
  process.exitCode = 1;
});
