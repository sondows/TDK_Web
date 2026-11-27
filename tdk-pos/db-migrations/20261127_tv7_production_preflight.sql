-- Read-only TV-7 production schema inventory. Run in phpMyAdmin on TDK_POS.
-- phpMyAdmin can display information_schema as the active SQL tab database;
-- every inventory query below explicitly targets TDK_POS.
SELECT DATABASE() AS session_database, 'TDK_POS' AS inspected_schema, VERSION() AS database_version;
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='TDK_POS' AND TABLE_NAME IN
  ('tv_qr_auth_code_state','dining_tables','qr_sessions','qr_orders','table_sessions','qr_table_order_claims','qr_order_auth_attempts')
ORDER BY TABLE_NAME, ORDINAL_POSITION;
SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA='TDK_POS' AND TABLE_NAME IN
  ('tv_qr_auth_code_state','dining_tables','qr_sessions','qr_orders','table_sessions','qr_table_order_claims','qr_order_auth_attempts')
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;
SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA='TDK_POS' AND TABLE_NAME IN ('qr_table_order_claims','qr_order_auth_attempts')
ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION;
