-- Read-only preflight. Select TDK_POS in phpMyAdmin before running.
SELECT DATABASE() AS selected_database, VERSION() AS mariadb_version;

-- Must return exactly these five mappings, with the stated purpose.
SELECT screen_id, code, name, purpose, sync_group
FROM TDK_POS.tv_screens
ORDER BY screen_id;

-- Must return zero rows. Any result means a target code is already used by another row.
SELECT screen_id, code, name
FROM TDK_POS.tv_screens
WHERE code IN ('DP1','DP2','DP3','DP4','DP5')
  AND NOT ((screen_id=5 AND code='DP1') OR (screen_id=1 AND code='DP2') OR
           (screen_id=2 AND code='DP3') OR (screen_id=3 AND code='DP4') OR
           (screen_id=4 AND code='DP5'));

-- Record existing TV row counts. These rows must be preserved by the migration.
SELECT 'tv_screens' AS table_name, COUNT(*) AS row_count FROM TDK_POS.tv_screens
UNION ALL SELECT 'tv_images', COUNT(*) FROM TDK_POS.tv_images
UNION ALL SELECT 'tv_image_events', COUNT(*) FROM TDK_POS.tv_image_events
UNION ALL SELECT 'tv_qr_auth_code_state', COUNT(*) FROM TDK_POS.tv_qr_auth_code_state;

-- Inspect current screen columns and indexes before applying the migration.
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='TDK_POS' AND TABLE_NAME='tv_screens'
ORDER BY ORDINAL_POSITION;
SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA='TDK_POS' AND TABLE_NAME='tv_screens'
ORDER BY INDEX_NAME, SEQ_IN_INDEX;

-- Current expected baseline: tv_sync_groups and tv_business_notice have no rows/tables.
-- If either already exists, inspect its full definition and data before using the rerunnable migration.
SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA='TDK_POS' AND TABLE_NAME IN ('tv_sync_groups','tv_business_notice');

-- Existing TV image/event relationships. Image file bytes live outside the database.
SELECT s.screen_id, s.code, COUNT(i.image_id) AS image_rows
FROM TDK_POS.tv_screens s LEFT JOIN TDK_POS.tv_images i ON i.screen_id=s.screen_id
GROUP BY s.screen_id, s.code ORDER BY s.screen_id;
SELECT COUNT(*) AS event_rows FROM TDK_POS.tv_image_events;
