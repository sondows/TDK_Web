-- DBA ONLY: development database TDK_POS_TEST.
-- Do not run this file against TDK_POS or on a production NAS.
-- Adds an optional per-category tab color. Existing category IDs and menu links are unchanged.
--
-- Step 1: run the preflight and stop unless actual_database = TDK_POS_TEST.
SELECT DATABASE() AS actual_database;

-- Step 2: run only after verifying the selected database above.
ALTER TABLE TDK_POS_TEST.menu_categories
  ADD COLUMN IF NOT EXISTS tab_color VARCHAR(7) NULL DEFAULT NULL AFTER is_active;

-- Step 3: verify the column and that existing categories are unset by default.
SHOW COLUMNS FROM TDK_POS_TEST.menu_categories LIKE 'tab_color';
SELECT COUNT(*) AS category_rows,
       SUM(tab_color IS NULL) AS categories_using_default_style,
       SUM(tab_color IS NOT NULL) AS categories_with_custom_color
FROM TDK_POS_TEST.menu_categories;
