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
  await connection.query(`CREATE TABLE IF NOT EXISTS system_settings (
    setting_key VARCHAR(100) NOT NULL,
    setting_value VARCHAR(255) NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by_staff_id BIGINT UNSIGNED NULL,
    PRIMARY KEY (setting_key),
    KEY idx_system_settings_updated_by (updated_by_staff_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await connection.query(
    "INSERT INTO system_settings (setting_key, setting_value) VALUES ('pos_idle_reset_seconds', '60') ON DUPLICATE KEY UPDATE setting_value = setting_value"
  );
  await connection.query(
    "INSERT INTO system_settings (setting_key, setting_value) VALUES ('pos_login_mode', 'PERSONAL') ON DUPLICATE KEY UPDATE setting_value = setting_value"
  );
  const [rows] = await connection.query("SELECT setting_key, setting_value, updated_at, updated_by_staff_id FROM system_settings WHERE setting_key = 'pos_idle_reset_seconds'");
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await connection.end();
}
