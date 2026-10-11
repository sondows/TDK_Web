-- Run against TDK_POS_TEST first, then TDK_POS. Select the target database
-- in the SQL client before executing this file. Safe to run again per database.
-- Existing payment methods and settings are preserved; account info defaults OFF.

SET @account_info_schema := DATABASE();

SET @account_info_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @account_info_schema
    AND TABLE_NAME = 'payment_method_settings'
    AND COLUMN_NAME = 'account_info_enabled'
);
SET @account_info_ddl := IF(@account_info_exists = 0,
  'ALTER TABLE `payment_method_settings` ADD COLUMN `account_info_enabled` TINYINT NOT NULL DEFAULT 0',
  'SELECT ''account_info_enabled already exists; skipped''');
PREPARE account_info_stmt FROM @account_info_ddl;
EXECUTE account_info_stmt;
DEALLOCATE PREPARE account_info_stmt;

SET @account_info_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @account_info_schema
    AND TABLE_NAME = 'payment_method_settings'
    AND COLUMN_NAME = 'bank_name'
);
SET @account_info_ddl := IF(@account_info_exists = 0,
  'ALTER TABLE `payment_method_settings` ADD COLUMN `bank_name` VARCHAR(100) NULL',
  'SELECT ''bank_name already exists; skipped''');
PREPARE account_info_stmt FROM @account_info_ddl;
EXECUTE account_info_stmt;
DEALLOCATE PREPARE account_info_stmt;

SET @account_info_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @account_info_schema
    AND TABLE_NAME = 'payment_method_settings'
    AND COLUMN_NAME = 'account_number'
);
SET @account_info_ddl := IF(@account_info_exists = 0,
  'ALTER TABLE `payment_method_settings` ADD COLUMN `account_number` VARCHAR(100) NULL',
  'SELECT ''account_number already exists; skipped''');
PREPARE account_info_stmt FROM @account_info_ddl;
EXECUTE account_info_stmt;
DEALLOCATE PREPARE account_info_stmt;

SET @account_info_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @account_info_schema
    AND TABLE_NAME = 'payment_method_settings'
    AND COLUMN_NAME = 'account_holder'
);
SET @account_info_ddl := IF(@account_info_exists = 0,
  'ALTER TABLE `payment_method_settings` ADD COLUMN `account_holder` VARCHAR(100) NULL',
  'SELECT ''account_holder already exists; skipped''');
PREPARE account_info_stmt FROM @account_info_ddl;
EXECUTE account_info_stmt;
DEALLOCATE PREPARE account_info_stmt;
