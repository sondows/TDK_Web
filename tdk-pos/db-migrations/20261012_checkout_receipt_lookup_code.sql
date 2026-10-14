-- Apply to TDK_POS_TEST first. After verification, apply the same file to TDK_POS.
-- Select the intended database in the SQL client before running this script.
-- Existing checkouts remain NULL; no historical sale is changed or backfilled.
SET @lookup_schema := DATABASE();
SET @lookup_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @lookup_schema AND TABLE_NAME = 'checkouts'
    AND COLUMN_NAME = 'receipt_lookup_code'
);
SET @lookup_column_ddl := IF(@lookup_column_exists = 0,
  'ALTER TABLE `checkouts` ADD COLUMN `receipt_lookup_code` VARCHAR(16) NULL',
  'SELECT ''receipt_lookup_code already exists; skipped''');
PREPARE lookup_column_stmt FROM @lookup_column_ddl;
EXECUTE lookup_column_stmt;
DEALLOCATE PREPARE lookup_column_stmt;

SET @lookup_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @lookup_schema AND TABLE_NAME = 'checkouts'
    AND INDEX_NAME = 'uq_checkouts_receipt_lookup_code'
);
SET @lookup_index_ddl := IF(@lookup_index_exists = 0,
  'ALTER TABLE `checkouts` ADD UNIQUE KEY `uq_checkouts_receipt_lookup_code` (`receipt_lookup_code`)',
  'SELECT ''uq_checkouts_receipt_lookup_code already exists; skipped''');
PREPARE lookup_index_stmt FROM @lookup_index_ddl;
EXECUTE lookup_index_stmt;
DEALLOCATE PREPARE lookup_index_stmt;
