-- Read-only diagnostic. Run in the active database selected by the NAS app.
-- This script does not return device names, IDs, token hashes, staff IDs, or PIN data.
SELECT DATABASE() AS active_database, @@hostname AS mariadb_host, VERSION() AS mariadb_version;

SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('managed_devices', 'kds_trusted_devices', 'staff_sessions')
ORDER BY TABLE_NAME;

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('managed_devices', 'kds_trusted_devices', 'staff_sessions')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE
FROM information_schema.TABLE_CONSTRAINTS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'managed_devices'
ORDER BY CONSTRAINT_TYPE, CONSTRAINT_NAME;

SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'managed_devices'
ORDER BY INDEX_NAME, SEQ_IN_INDEX;

SET @has_managed_devices := (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'managed_devices'
);
SET @device_counts_sql := IF(
  @has_managed_devices = 1,
  'SELECT device_type, status, COUNT(*) AS row_count, SUM(token_hash IS NOT NULL) AS approved_token_rows, SUM(request_token_hash IS NOT NULL) AS pending_token_rows FROM managed_devices GROUP BY device_type, status ORDER BY device_type, status',
  'SELECT ''managed_devices table is missing'' AS diagnostic'
);
PREPARE device_counts_stmt FROM @device_counts_sql;
EXECUTE device_counts_stmt;
DEALLOCATE PREPARE device_counts_stmt;

SET @has_legacy_devices := (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kds_trusted_devices'
);
SET @legacy_count_sql := IF(
  @has_legacy_devices = 1,
  'SELECT COUNT(*) AS legacy_kds_device_rows, SUM(token_hash IS NOT NULL) AS legacy_token_rows FROM kds_trusted_devices',
  'SELECT ''kds_trusted_devices table is missing'' AS diagnostic'
);
PREPARE legacy_count_stmt FROM @legacy_count_sql;
EXECUTE legacy_count_stmt;
DEALLOCATE PREPARE legacy_count_stmt;
