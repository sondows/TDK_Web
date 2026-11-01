-- TDKON schema synchronization: read-only preflight
-- Run with MariaDB 10.11.18 credentials that can read both schemas.
-- This file contains SELECT/SHOW only; it makes no changes.

SELECT DATABASE() AS connected_database, VERSION() AS mariadb_version,
       @@character_set_database AS database_charset,
       @@collation_database AS database_collation;
SELECT CURRENT_USER() AS effective_account, USER() AS connected_account;
SELECT 'TDK_POS_TEST' AS expected_development_db, 'TDK_POS' AS expected_production_db;

-- SHOW GRANTS was inspected privately for this audit. Its MariaDB output can
-- contain an IDENTIFIED BY PASSWORD verifier; do not save or share that raw
-- output. Check only the specific SHOW VIEW privilege without exposing it:
SELECT GRANTEE, TABLE_SCHEMA, PRIVILEGE_TYPE
FROM information_schema.SCHEMA_PRIVILEGES
WHERE TABLE_SCHEMA='TDK_POS_TEST' AND PRIVILEGE_TYPE='SHOW VIEW'
ORDER BY GRANTEE;

-- Database defaults and base table/view inventory.
SELECT SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME
FROM information_schema.SCHEMATA
WHERE SCHEMA_NAME IN ('TDK_POS_TEST','TDK_POS') ORDER BY SCHEMA_NAME;
SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA IN ('TDK_POS_TEST','TDK_POS')
ORDER BY TABLE_NAME, TABLE_SCHEMA;

-- Full column definitions. Compare name, ordinal, type, nullability, default,
-- auto_increment/other EXTRA attributes, and character set/collation.
SELECT TABLE_NAME, COLUMN_NAME, TABLE_SCHEMA, ORDINAL_POSITION, COLUMN_TYPE,
       IS_NULLABLE, COLUMN_DEFAULT, EXTRA, CHARACTER_SET_NAME, COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA IN ('TDK_POS_TEST','TDK_POS')
ORDER BY TABLE_NAME, ORDINAL_POSITION, TABLE_SCHEMA;

-- Index and key definitions, including column order and uniqueness.
SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX,
       COLUMN_NAME, SUB_PART, COLLATION, INDEX_TYPE
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA IN ('TDK_POS_TEST','TDK_POS')
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, TABLE_SCHEMA;

-- Foreign keys and referential actions.
SELECT k.CONSTRAINT_SCHEMA, k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME,
       k.REFERENCED_TABLE_SCHEMA, k.REFERENCED_TABLE_NAME,
       k.REFERENCED_COLUMN_NAME, k.ORDINAL_POSITION,
       r.DELETE_RULE, r.UPDATE_RULE
FROM information_schema.KEY_COLUMN_USAGE AS k
JOIN information_schema.REFERENTIAL_CONSTRAINTS AS r
  ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
WHERE k.CONSTRAINT_SCHEMA IN ('TDK_POS_TEST','TDK_POS')
  AND k.REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION, k.CONSTRAINT_SCHEMA;

-- VIEW metadata and definition availability. VIEW_DEFINITION may be NULL when
-- the account lacks SHOW VIEW; do not construct replacement SQL from NULL.
SELECT TABLE_SCHEMA, TABLE_NAME, DEFINER, SECURITY_TYPE, CHECK_OPTION,
       IS_UPDATABLE, VIEW_DEFINITION IS NOT NULL AS definition_available,
       SHA2(VIEW_DEFINITION,256) AS definition_sha256
FROM information_schema.VIEWS
WHERE TABLE_SCHEMA IN ('TDK_POS_TEST','TDK_POS')
ORDER BY TABLE_NAME, TABLE_SCHEMA;

-- Run sql/schema-sync/05_view_definition_extract.sql after the DBA grants the
-- narrowly scoped SHOW VIEW privilege in sql/schema-sync/00_dba_show_view_grant.sql.

-- Triggers, routines (procedures/functions), and events.
SELECT TRIGGER_SCHEMA AS object_schema, TRIGGER_NAME AS object_name,
       EVENT_OBJECT_TABLE AS related_table, ACTION_TIMING, EVENT_MANIPULATION,
       ACTION_STATEMENT
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA IN ('TDK_POS_TEST','TDK_POS') ORDER BY object_schema, object_name;
SELECT ROUTINE_SCHEMA AS object_schema, ROUTINE_NAME AS object_name,
       ROUTINE_TYPE, DATA_TYPE, SECURITY_TYPE, ROUTINE_DEFINITION
FROM information_schema.ROUTINES
WHERE ROUTINE_SCHEMA IN ('TDK_POS_TEST','TDK_POS') ORDER BY object_schema, object_name;
SELECT EVENT_SCHEMA AS object_schema, EVENT_NAME AS object_name,
       STATUS, EVENT_DEFINITION
FROM information_schema.EVENTS
WHERE EVENT_SCHEMA IN ('TDK_POS_TEST','TDK_POS') ORDER BY object_schema, object_name;

-- Exact operational row counts to save before any future DDL.
SELECT 'TDK_POS_TEST' AS db_name, 'orders' AS table_name, COUNT(*) AS row_count FROM TDK_POS_TEST.orders
UNION ALL SELECT 'TDK_POS_TEST','order_items',COUNT(*) FROM TDK_POS_TEST.order_items
UNION ALL SELECT 'TDK_POS_TEST','payments',COUNT(*) FROM TDK_POS_TEST.payments
UNION ALL SELECT 'TDK_POS_TEST','checkouts',COUNT(*) FROM TDK_POS_TEST.checkouts
UNION ALL SELECT 'TDK_POS_TEST','inventory_transactions',COUNT(*) FROM TDK_POS_TEST.inventory_transactions
UNION ALL SELECT 'TDK_POS_TEST','audit_logs',COUNT(*) FROM TDK_POS_TEST.audit_logs
UNION ALL SELECT 'TDK_POS','orders',COUNT(*) FROM TDK_POS.orders
UNION ALL SELECT 'TDK_POS','order_items',COUNT(*) FROM TDK_POS.order_items
UNION ALL SELECT 'TDK_POS','payments',COUNT(*) FROM TDK_POS.payments
UNION ALL SELECT 'TDK_POS','checkouts',COUNT(*) FROM TDK_POS.checkouts
UNION ALL SELECT 'TDK_POS','inventory_transactions',COUNT(*) FROM TDK_POS.inventory_transactions
UNION ALL SELECT 'TDK_POS','audit_logs',COUNT(*) FROM TDK_POS.audit_logs
ORDER BY db_name, table_name;

-- Staff/auth preservation check: only registration flags and equality booleans;
-- never select or print hash values themselves.
SELECT p.admin_login_id, p.staff_code, p.role, p.is_active, p.terminated_at,
       p.pos_enabled, p.admin_enabled, p.kds_enabled,
       p.security_password_hash IS NOT NULL AND p.security_password_hash<>'' AS master_registered,
       p.employee_pin_hash IS NOT NULL AND p.employee_pin_hash<>'' AS common_pin_registered,
       BINARY(p.security_password_hash)=BINARY(d.security_password_hash) AS master_hash_matches_test,
       BINARY(p.employee_pin_hash)=BINARY(d.employee_pin_hash) AS pin_hash_matches_test
FROM TDK_POS.staff AS p
JOIN TDK_POS_TEST.staff AS d ON d.admin_login_id=p.admin_login_id
ORDER BY p.admin_login_id;

-- Specific discrepancy preflight.
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA IN ('TDK_POS_TEST','TDK_POS')
  AND ((TABLE_NAME='staff' AND COLUMN_NAME='hos_enabled')
    OR (TABLE_NAME='managed_devices' AND COLUMN_NAME='device_type'))
ORDER BY TABLE_NAME, TABLE_SCHEMA;
SELECT TABLE_SCHEMA, device_type, COUNT(*) AS rows_by_type
FROM (SELECT 'TDK_POS_TEST' AS TABLE_SCHEMA, device_type FROM TDK_POS_TEST.managed_devices
      UNION ALL SELECT 'TDK_POS', device_type FROM TDK_POS.managed_devices) AS devices
GROUP BY TABLE_SCHEMA, device_type ORDER BY TABLE_SCHEMA, device_type;
