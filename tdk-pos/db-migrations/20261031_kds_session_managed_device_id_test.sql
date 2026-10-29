-- TDK_POS_TEST only. Run before deploying code that uses staff_sessions.managed_device_id.
-- Keeps the legacy device_id -> pos_devices foreign key and all existing sessions intact.
-- New KDS sessions bind to the managed_devices key in a dedicated nullable column.

ALTER TABLE TDK_POS_TEST.staff_sessions
  ADD COLUMN IF NOT EXISTS managed_device_id BIGINT UNSIGNED NULL AFTER device_id;

SET @managed_device_fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = 'TDK_POS_TEST'
    AND TABLE_NAME = 'staff_sessions'
    AND CONSTRAINT_NAME = 'fk_staff_sessions_managed_device'
);

SET @managed_device_fk_sql := IF(
  @managed_device_fk_exists = 0,
  'ALTER TABLE TDK_POS_TEST.staff_sessions ADD CONSTRAINT fk_staff_sessions_managed_device FOREIGN KEY (managed_device_id) REFERENCES TDK_POS_TEST.managed_devices (device_id) ON DELETE SET NULL ON UPDATE RESTRICT',
  'SELECT ''fk_staff_sessions_managed_device already exists'' AS migration_status'
);

PREPARE add_managed_device_fk FROM @managed_device_fk_sql;
EXECUTE add_managed_device_fk;
DEALLOCATE PREPARE add_managed_device_fk;

-- Existing KDS code stored managed_devices.device_id in the legacy device_id
-- column. Backfill only IDs that still match a managed_devices row; POS rows
-- and unrelated historical device references remain untouched.
UPDATE TDK_POS_TEST.staff_sessions AS session_row
JOIN TDK_POS_TEST.managed_devices AS managed_device
  ON managed_device.device_id = session_row.device_id
SET session_row.managed_device_id = managed_device.device_id
WHERE session_row.session_type = 'KDS'
  AND session_row.device_id IS NOT NULL
  AND session_row.managed_device_id IS NULL;

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'TDK_POS_TEST'
  AND TABLE_NAME = 'staff_sessions'
  AND COLUMN_NAME IN ('device_id', 'managed_device_id');

SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_SCHEMA,
       REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'TDK_POS_TEST'
  AND TABLE_NAME = 'staff_sessions'
  AND REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY CONSTRAINT_NAME;
