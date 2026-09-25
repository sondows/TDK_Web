import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });
const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306), user: process.env.DB_USER?.trim(), password: process.env.DB_PASSWORD, database: process.env.DB_NAME });

try {
  await connection.query(`CREATE TABLE IF NOT EXISTS order_item_cancellations (
    cancellation_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_item_id BIGINT UNSIGNED NOT NULL,
    cancelled_qty INT NOT NULL,
    cancelled_amount DECIMAL(14,2) NOT NULL,
    cancellation_reason VARCHAR(500) NOT NULL,
    cancelled_by_staff_id BIGINT UNSIGNED NOT NULL,
    cancelled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cancellation_id),
    KEY idx_order_item_cancellations_item (order_item_id, cancelled_at),
    KEY idx_order_item_cancellations_staff (cancelled_by_staff_id),
    CONSTRAINT fk_order_item_cancellations_item FOREIGN KEY (order_item_id) REFERENCES order_items(order_item_id),
    CONSTRAINT fk_order_item_cancellations_staff FOREIGN KEY (cancelled_by_staff_id) REFERENCES staff(staff_id),
    CONSTRAINT chk_order_item_cancellations_qty CHECK (cancelled_qty > 0)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  for (const [key, value] of [["order_cancel_reauth_minutes", "10"], ["order_item_cancel_always_reauth", "false"], ["whole_order_cancel_always_reauth", "true"]]) await connection.query("INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = setting_value", [key, value]);
  const [settings] = await connection.query("SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('order_cancel_reauth_minutes','order_item_cancel_always_reauth','whole_order_cancel_always_reauth') ORDER BY setting_key");
  console.log(JSON.stringify(settings, null, 2));
} finally { await connection.end(); }
