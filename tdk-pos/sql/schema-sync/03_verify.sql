-- TDKON post-sync verification: read-only; run against MariaDB 10.11.18.
-- This script does not modify data or schema.
SELECT DATABASE() AS connected_database, VERSION() AS mariadb_version;

-- Table names, engines, table collations.
SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA IN ('TDK_POS_TEST','TDK_POS') ORDER BY TABLE_NAME,TABLE_SCHEMA;

-- Remaining column differences (includes ordinal position).
SELECT COALESCE(d.TABLE_NAME,p.TABLE_NAME) AS table_name,
       COALESCE(d.COLUMN_NAME,p.COLUMN_NAME) AS column_name,
       d.ORDINAL_POSITION AS test_position, p.ORDINAL_POSITION AS production_position,
       d.COLUMN_TYPE AS test_type, p.COLUMN_TYPE AS production_type,
       d.IS_NULLABLE AS test_nullable, p.IS_NULLABLE AS production_nullable,
       d.COLUMN_DEFAULT AS test_default, p.COLUMN_DEFAULT AS production_default,
       d.EXTRA AS test_extra, p.EXTRA AS production_extra
FROM (SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='TDK_POS_TEST') d
LEFT JOIN (SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='TDK_POS') p
  ON p.TABLE_NAME=d.TABLE_NAME AND p.COLUMN_NAME=d.COLUMN_NAME
WHERE p.COLUMN_NAME IS NULL OR d.ORDINAL_POSITION<>p.ORDINAL_POSITION
   OR d.COLUMN_TYPE<>p.COLUMN_TYPE OR d.IS_NULLABLE<>p.IS_NULLABLE
   OR NOT (d.COLUMN_DEFAULT <=> p.COLUMN_DEFAULT) OR d.EXTRA<>p.EXTRA
UNION ALL
SELECT p.TABLE_NAME,p.COLUMN_NAME,d.ORDINAL_POSITION,p.ORDINAL_POSITION,
       d.COLUMN_TYPE,p.COLUMN_TYPE,d.IS_NULLABLE,p.IS_NULLABLE,
       d.COLUMN_DEFAULT,p.COLUMN_DEFAULT,d.EXTRA,p.EXTRA
FROM (SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='TDK_POS') p
LEFT JOIN (SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='TDK_POS_TEST') d
  ON d.TABLE_NAME=p.TABLE_NAME AND d.COLUMN_NAME=p.COLUMN_NAME
WHERE d.COLUMN_NAME IS NULL
ORDER BY table_name,column_name;

-- Index definitions; matching names alone are insufficient.
SELECT TABLE_SCHEMA,TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,
       SUB_PART,COLLATION,INDEX_TYPE
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA IN ('TDK_POS_TEST','TDK_POS')
ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX,TABLE_SCHEMA;

-- Foreign key columns and ON DELETE/ON UPDATE rules.
SELECT k.CONSTRAINT_SCHEMA,k.TABLE_NAME,k.CONSTRAINT_NAME,k.COLUMN_NAME,
       k.REFERENCED_TABLE_SCHEMA,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,
       k.ORDINAL_POSITION,r.DELETE_RULE,r.UPDATE_RULE
FROM information_schema.KEY_COLUMN_USAGE k
JOIN information_schema.REFERENTIAL_CONSTRAINTS r
  ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
WHERE k.CONSTRAINT_SCHEMA IN ('TDK_POS_TEST','TDK_POS')
  AND k.REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION,k.CONSTRAINT_SCHEMA;

-- VIEW definitions/hashes. NULL means unavailable, not equal.
SELECT TABLE_SCHEMA,TABLE_NAME,DEFINER,SECURITY_TYPE,CHECK_OPTION,IS_UPDATABLE,
       VIEW_DEFINITION IS NOT NULL AS definition_available,
       SHA2(VIEW_DEFINITION,256) AS definition_sha256
FROM information_schema.VIEWS
WHERE TABLE_SCHEMA IN ('TDK_POS_TEST','TDK_POS') ORDER BY TABLE_NAME,TABLE_SCHEMA;

-- Triggers, routines, and events.
SELECT TRIGGER_SCHEMA,TRIGGER_NAME,EVENT_OBJECT_TABLE,ACTION_TIMING,EVENT_MANIPULATION,ACTION_STATEMENT
FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA IN ('TDK_POS_TEST','TDK_POS');
SELECT ROUTINE_SCHEMA,ROUTINE_NAME,ROUTINE_TYPE,DATA_TYPE,SECURITY_TYPE,ROUTINE_DEFINITION
FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA IN ('TDK_POS_TEST','TDK_POS');
SELECT EVENT_SCHEMA,EVENT_NAME,STATUS,EVENT_DEFINITION
FROM information_schema.EVENTS WHERE EVENT_SCHEMA IN ('TDK_POS_TEST','TDK_POS');

-- Employee/auth preservation: booleans only; hash material is never returned.
SELECT p.admin_login_id, p.staff_code, p.role, p.is_active, p.terminated_at,
       p.pos_enabled, p.admin_enabled, p.kds_enabled, p.hos_enabled,
       p.security_password_hash IS NOT NULL AND p.security_password_hash<>'' AS master_registered,
       p.employee_pin_hash IS NOT NULL AND p.employee_pin_hash<>'' AS common_pin_registered,
       BINARY(p.security_password_hash)=BINARY(d.security_password_hash) AS master_hash_matches_test,
       BINARY(p.employee_pin_hash)=BINARY(d.employee_pin_hash) AS pin_hash_matches_test
FROM TDK_POS.staff p JOIN TDK_POS_TEST.staff d ON d.admin_login_id=p.admin_login_id
ORDER BY p.admin_login_id;
SELECT s.admin_login_id, COUNT(*) AS active_sessions
FROM TDK_POS.staff_sessions ss JOIN TDK_POS.staff s ON s.staff_id=ss.staff_id
WHERE ss.status='ACTIVE' GROUP BY s.admin_login_id ORDER BY s.admin_login_id;
SELECT s.admin_login_id,t.program,COUNT(*) AS active_trust_tokens
FROM TDK_POS.program_trust_tokens t JOIN TDK_POS.staff s ON s.staff_id=t.enrolled_by_staff_id
WHERE t.revoked_at IS NULL GROUP BY s.admin_login_id,t.program ORDER BY s.admin_login_id,t.program;

-- Operational data counts are expected to differ between TEST and PROD.
-- Compare production counts with the saved 01_preflight output and protected backup;
-- do not compare them to development row counts.
SELECT 'orders' AS table_name,COUNT(*) AS row_count FROM TDK_POS.orders
UNION ALL SELECT 'order_items',COUNT(*) FROM TDK_POS.order_items
UNION ALL SELECT 'payments',COUNT(*) FROM TDK_POS.payments
UNION ALL SELECT 'checkouts',COUNT(*) FROM TDK_POS.checkouts
UNION ALL SELECT 'inventory_transactions',COUNT(*) FROM TDK_POS.inventory_transactions
UNION ALL SELECT 'audit_logs',COUNT(*) FROM TDK_POS.audit_logs;