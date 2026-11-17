-- Run only after verifying the TDK_POS_TEST menu backup.
-- Drops only menus.menu_number; all menu IDs and sort_order values remain intact.
SET @menu_number_target_schema := 'TDK_POS_TEST';
SET @menu_number_column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'menus'
    AND COLUMN_NAME = 'menu_number'
);
SET @menu_number_ddl := CASE
  WHEN NOT (DATABASE() <=> @menu_number_target_schema) THEN 'SELECT * FROM `__wrong_database_for_menu_number_migration__`'
  WHEN @menu_number_column_exists > 0 THEN 'ALTER TABLE `menus` DROP COLUMN `menu_number`'
  ELSE 'SELECT ''menus.menu_number already absent'''
END;
PREPARE menu_number_stmt FROM @menu_number_ddl;
EXECUTE menu_number_stmt;
DEALLOCATE PREPARE menu_number_stmt;
