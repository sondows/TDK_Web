-- Idempotent migration for both TDK_POS_TEST and TDK_POS.
-- Select the target database in the SQL client before running this file.
-- Existing customers are preserved; customer_id order is assigned only when
-- sort_order is first created. Re-running this file will not reset saved order.

SET @customer_sort_order_schema := DATABASE();
SET @customer_sort_order_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @customer_sort_order_schema
    AND TABLE_NAME = 'customers'
    AND COLUMN_NAME = 'sort_order'
);

SET @customer_sort_order_ddl := IF(
  @customer_sort_order_exists = 0,
  'ALTER TABLE `customers` ADD COLUMN `sort_order` INT NOT NULL DEFAULT 0',
  'SELECT ''customers.sort_order already exists; skipped'''
);
PREPARE customer_sort_order_stmt FROM @customer_sort_order_ddl;
EXECUTE customer_sort_order_stmt;
DEALLOCATE PREPARE customer_sort_order_stmt;

SET @customer_sort_order_row := 0;
SET @customer_sort_order_backfill := IF(
  @customer_sort_order_exists = 0,
  'UPDATE `customers` SET `sort_order` = (@customer_sort_order_row := @customer_sort_order_row + 1) ORDER BY `customer_id` ASC',
  'SELECT ''customer order preserved; backfill skipped'''
);
PREPARE customer_sort_order_backfill_stmt FROM @customer_sort_order_backfill;
EXECUTE customer_sort_order_backfill_stmt;
DEALLOCATE PREPARE customer_sort_order_backfill_stmt;
