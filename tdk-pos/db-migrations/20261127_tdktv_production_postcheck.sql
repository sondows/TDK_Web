-- Read-only post-migration check. Select TDK_POS in phpMyAdmin before running.
SELECT DATABASE() AS selected_database;

-- Must show the original IDs with DP codes and preserved existing Korean names/purpose.
SELECT screen_id, code, name, purpose, transition_effect, physical_order, layout_x, layout_y
FROM TDK_POS.tv_screens
ORDER BY screen_id;

-- Must return zero rows: all expected mappings exist and no extra DP code is assigned.
SELECT expected.screen_id, expected.code AS expected_code, s.code AS actual_code, s.purpose
FROM (
  SELECT 5 AS screen_id, 'DP1' AS code, 'ADVERTISEMENT' AS purpose UNION ALL
  SELECT 1, 'DP2', 'MENU' UNION ALL SELECT 2, 'DP3', 'MENU' UNION ALL
  SELECT 3, 'DP4', 'MENU' UNION ALL SELECT 4, 'DP5', 'MENU'
) expected
LEFT JOIN TDK_POS.tv_screens s ON s.screen_id=expected.screen_id
WHERE s.screen_id IS NULL OR s.code<>expected.code OR s.purpose<>expected.purpose;

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='TDK_POS' AND (
  (TABLE_NAME='tv_screens' AND COLUMN_NAME IN ('transition_effect','physical_order','layout_x','layout_y')) OR
  TABLE_NAME IN ('tv_sync_groups','tv_business_notice'))
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA='TDK_POS' AND TABLE_NAME IN ('tv_screens','tv_sync_groups','tv_business_notice')
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

-- Counts should match the preflight values. No image/event/QR-auth rows are inserted or deleted.
SELECT 'tv_screens' AS table_name, COUNT(*) AS row_count FROM TDK_POS.tv_screens
UNION ALL SELECT 'tv_images', COUNT(*) FROM TDK_POS.tv_images
UNION ALL SELECT 'tv_image_events', COUNT(*) FROM TDK_POS.tv_image_events
UNION ALL SELECT 'tv_qr_auth_code_state', COUNT(*) FROM TDK_POS.tv_qr_auth_code_state;
SELECT s.screen_id, s.code, COUNT(i.image_id) AS image_rows
FROM TDK_POS.tv_screens s LEFT JOIN TDK_POS.tv_images i ON i.screen_id=s.screen_id
GROUP BY s.screen_id, s.code ORDER BY s.screen_id;
