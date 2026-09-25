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
  await connection.execute(
    "INSERT INTO staff (staff_code, name, role, is_active, cancel_requires_pin) VALUES (?, ?, 'STAFF', 1, 0) ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1",
    ["000", "매장 공용"],
  );
  const [rows] = await connection.execute("SELECT staff_id, staff_code, name, is_active FROM staff WHERE staff_code = ?", ["000"]);
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await connection.end();
}
