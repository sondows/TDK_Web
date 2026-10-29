-- Production migration for TDK_POS. Do not run without explicit approval.
-- Keeps the legacy device_id -> pos_devices foreign key and existing sessions intact.
-- New KDS sessions bind to managed_devices through this separate nullable key.

ALTER TABLE TDK_POS.staff_sessions
  ADD COLUMN IF NOT EXISTS managed_device_id BIGINT UNSIGNED NULL AFTER device_id;

SET @managed_device_fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = 'TDK_POS'
    AND TABLE_NAME = 'staff_sessions'
    AND CONSTRAINT_NAME = 'fk_staff_sessions_managed_device'
);

SET @managed_device_fk_sql := IF(
  @managed_device_fk_exists = 0,
  'ALTER TABLE TDK_POS.staff_sessions ADD CONSTRAINT fk_staff_sessions_managed_device FOREIGN KEY (managed_device_id) REFERENCES TDK_POS.managed_devices (device_id) ON DELETE SET NULL ON UPDATE RESTRICT',
  'SELECT ''fk_staff_sessions_managed_device already exists'' AS migration_status'
);

PREPARE add_managed_device_fk FROM @managed_device_fk_sql;
EXECUTE add_managed_device_fk;
DEALLOCATE PREPARE add_managed_device_fk;

-- Preserve existing KDS bindings only where the old stored value still maps
-- to a managed-device row. POS rows remain attached to pos_devices.
UPDATE TDK_POS.staff_sessions AS session_row
JOIN TDK_POS.managed_devices AS managed_device
  ON managed_device.device_id = session_row.device_id
SET session_row.managed_device_id = managed_device.device_id
WHERE session_row.session_type = 'KDS'
  AND session_row.device_id IS NOT NULL
  AND session_row.managed_device_id IS NULL;

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'TDK_POS'
  AND TABLE_NAME = 'staff_sessions'
  AND COLUMN_NAME IN ('device_id', 'managed_device_id');

SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_SCHEMA,
       REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'TDK_POS'
  AND TABLE_NAME = 'staff_sessions'
  AND REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY CONSTRAINT_NAME;
