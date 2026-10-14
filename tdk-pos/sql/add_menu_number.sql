-- Idempotent migration for TDK_POS_TEST first, then TDK_POS.
-- Select the target database in the SQL client before running this file.
-- Existing menu rows and sort_order values are preserved. Menu numbers are
-- nullable and intentionally have no UNIQUE constraint; uniqueness is checked
-- by the menu management UI/API within each category.

SET @menu_number_schema := DATABASE();
SET @menu_number_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @menu_number_schema
    AND TABLE_NAME = 'menus'
    AND COLUMN_NAME = 'menu_number'
);

SET @menu_number_ddl := IF(
  @menu_number_exists = 0,
  'ALTER TABLE `menus` ADD COLUMN `menu_number` INT NULL DEFAULT NULL AFTER `counts_as_person`',
  'SELECT ''menus.menu_number already exists; skipped'''
);
PREPARE menu_number_stmt FROM @menu_number_ddl;
EXECUTE menu_number_stmt;
DEALLOCATE PREPARE menu_number_stmt;
