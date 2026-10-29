-- Test DB only. Add the columns required by the unified employee PIN and HOS permission code.
-- Existing staff rows, legacy PIN hashes, and program permissions are preserved.
ALTER TABLE TDK_POS_TEST.staff
  ADD COLUMN IF NOT EXISTS employee_pin_hash VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS hos_enabled TINYINT NOT NULL DEFAULT 0;

SELECT TABLE_SCHEMA, COLUMN_NAME, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'TDK_POS_TEST' AND TABLE_NAME = 'staff'
  AND COLUMN_NAME IN ('employee_pin_hash', 'hos_enabled')
ORDER BY COLUMN_NAME;
