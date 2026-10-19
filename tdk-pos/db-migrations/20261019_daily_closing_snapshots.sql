-- Additive calendar-date settlement history. Run on TEST, then production before deploying this code.
-- Do not migrate, delete, or rewrite existing business_sessions or historical sales.
CREATE TABLE IF NOT EXISTS daily_closing_snapshots (
  daily_closing_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sales_date DATE NOT NULL,
  revision INT UNSIGNED NOT NULL,
  request_key VARCHAR(36) NOT NULL,
  snapshot TEXT NOT NULL,
  closed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_by_staff_id BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_daily_closing_date_revision (sales_date, revision),
  UNIQUE KEY uq_daily_closing_request (request_key),
  KEY idx_daily_closing_date (sales_date, closed_at),
  CONSTRAINT fk_daily_closing_staff FOREIGN KEY (closed_by_staff_id) REFERENCES staff(staff_id)
);
