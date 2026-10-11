-- Run against TDK_POS_TEST first, then TDK_POS. Select the target database
-- in the SQL client before executing this file. Safe to run again per database.
-- Existing payment methods and account details are preserved; printing defaults OFF.

SET @account_print_schema := DATABASE();
SET @account_print_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @account_print_schema
    AND TABLE_NAME = 'payment_method_settings'
    AND COLUMN_NAME = 'account_info_print_enabled'
);
SET @account_print_ddl := IF(@account_print_exists = 0,
  'ALTER TABLE `payment_method_settings` ADD COLUMN `account_info_print_enabled` TINYINT NOT NULL DEFAULT 0',
  'SELECT ''account_info_print_enabled already exists; skipped''');
PREPARE account_print_stmt FROM @account_print_ddl;
EXECUTE account_print_stmt;
DEALLOCATE PREPARE account_print_stmt;
