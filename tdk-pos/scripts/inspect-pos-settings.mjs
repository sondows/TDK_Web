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
  const [identity] = await connection.query("SELECT CURRENT_USER() AS account_name, USER() AS connected_name");
  const [grants] = await connection.query("SHOW GRANTS");
  const [tables] = await connection.execute(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE '%setting%' ORDER BY table_name"
  );
  const [columns] = await connection.query("SHOW COLUMNS FROM system_settings");
  const [indexes] = await connection.query("SHOW INDEX FROM system_settings");
  const [settings] = await connection.query("SELECT setting_key, setting_value, updated_at, updated_by_staff_id FROM system_settings WHERE setting_key = 'pos_idle_reset_seconds'");
  console.log(JSON.stringify({ identity, grants, tables, columns, indexes, settings }, null, 2));
} finally {
  await connection.end();
}
