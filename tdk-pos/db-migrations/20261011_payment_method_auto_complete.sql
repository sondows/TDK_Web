-- Run against TDK_POS_TEST first, then TDK_POS. Select the target database
-- in the SQL client before executing this file. Safe to run again per database.
-- Other payment methods default to automatic completion ON. The account
-- transfer and voucher methods start OFF when this column is first introduced.

SET @auto_complete_schema := DATABASE();
SET @auto_complete_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @auto_complete_schema
    AND TABLE_NAME = 'payment_method_settings'
    AND COLUMN_NAME = 'auto_complete_enabled'
);
SET @auto_complete_ddl := IF(@auto_complete_exists = 0,
  'ALTER TABLE `payment_method_settings` ADD COLUMN `auto_complete_enabled` TINYINT NOT NULL DEFAULT 1',
  'SELECT ''auto_complete_enabled already exists; skipped''');
PREPARE auto_complete_stmt FROM @auto_complete_ddl;
EXECUTE auto_complete_stmt;
DEALLOCATE PREPARE auto_complete_stmt;

UPDATE payment_method_settings AS settings
INNER JOIN payment_methods AS methods
  ON methods.payment_method_id = settings.payment_method_id
SET settings.auto_complete_enabled = 0
WHERE @auto_complete_exists = 0
  AND methods.method_name IN ('계좌이체', '상품권');
