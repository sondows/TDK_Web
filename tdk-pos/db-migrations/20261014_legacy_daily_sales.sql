-- Apply only to TDK_POS_TEST for the first validation.
-- This archive has no foreign keys into live POS transactions or customer balances.
CREATE TABLE IF NOT EXISTS legacy_daily_sales (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_date DATE NOT NULL,
  sale_count INT UNSIGNED NOT NULL,
  gross_sales DECIMAL(14,2) NOT NULL,
  discount_amount DECIMAL(14,2) NOT NULL,
  net_sales DECIMAL(14,2) NOT NULL,
  card_amount DECIMAL(14,2) NOT NULL,
  cash_amount DECIMAL(14,2) NOT NULL,
  bank_transfer_amount DECIMAL(14,2) NOT NULL,
  other_amount DECIMAL(14,2) NOT NULL,
  cancelled_count INT UNSIGNED NOT NULL,
  cancelled_amount DECIMAL(14,2) NOT NULL,
  source VARCHAR(30) NOT NULL,
  imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_legacy_daily_sales_business_date (business_date),
  KEY idx_legacy_daily_sales_source_date (source, business_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
