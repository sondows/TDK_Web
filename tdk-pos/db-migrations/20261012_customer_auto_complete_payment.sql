-- Run against TDK_POS_TEST first, then TDK_POS. Select the target database
-- in the SQL client before executing this file. Safe to run again per database.
-- Existing customers default to automatic completion enabled to preserve
-- the current POS behavior.

SET @customer_auto_complete_schema := DATABASE();
SET @customer_auto_complete_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @customer_auto_complete_schema
    AND TABLE_NAME = 'customers'
    AND COLUMN_NAME = 'auto_complete_payment'
);
SET @customer_auto_complete_ddl := IF(@customer_auto_complete_exists = 0,
  'ALTER TABLE `customers` ADD COLUMN `auto_complete_payment` TINYINT NOT NULL DEFAULT 1',
  'SELECT ''auto_complete_payment already exists; skipped''');
PREPARE customer_auto_complete_stmt FROM @customer_auto_complete_ddl;
EXECUTE customer_auto_complete_stmt;
DEALLOCATE PREPARE customer_auto_complete_stmt;
