-- Production prerequisite for per-category menu tab colors.
-- Reviewed against TDK_POS_TEST and the production information_schema on 2026-11-13.
-- This file is not run by deploy.bat. Apply only in an approved production DB change window.
-- The fully qualified table name prevents an accidental change to another schema.
-- Existing menu_categories rows and values are retained; a newly added column is nullable.

SELECT DATABASE() AS connected_database;

ALTER TABLE TDK_POS.menu_categories
  ADD COLUMN IF NOT EXISTS tab_color VARCHAR(7) NULL DEFAULT NULL AFTER is_active;

SHOW COLUMNS FROM TDK_POS.menu_categories LIKE 'tab_color';

SELECT COUNT(*) AS category_rows,
       SUM(tab_color IS NULL) AS categories_using_default_style,
       SUM(tab_color IS NOT NULL) AS categories_with_custom_color
FROM TDK_POS.menu_categories;
