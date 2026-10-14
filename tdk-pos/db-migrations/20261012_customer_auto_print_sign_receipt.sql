-- Run against TDK_POS_TEST first, then TDK_POS after verification.
-- Existing customer prepaid payments already print sign receipts automatically,
-- so default ON preserves their current behavior. Select the target DB first.
SET @sign_receipt_schema := DATABASE();
SET @sign_receipt_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @sign_receipt_schema
    AND TABLE_NAME = 'customers'
    AND COLUMN_NAME = 'auto_print_sign_receipt'
);
SET @sign_receipt_ddl := IF(@sign_receipt_exists = 0,
  'ALTER TABLE `customers` ADD COLUMN `auto_print_sign_receipt` TINYINT NOT NULL DEFAULT 1',
  'SELECT ''auto_print_sign_receipt already exists; skipped''');
PREPARE sign_receipt_stmt FROM @sign_receipt_ddl;
EXECUTE sign_receipt_stmt;
DEALLOCATE PREPARE sign_receipt_stmt;
