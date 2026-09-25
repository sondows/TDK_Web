import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER?.trim(),
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

try {
  const [rows] = await connection.execute(
    "SELECT staff_id, staff_code, name, role, is_active FROM staff WHERE staff_code = ?",
    ["000"],
  );
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await connection.end();
}
