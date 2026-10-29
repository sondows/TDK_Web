-- Production DB. Review and obtain approval before running.
-- Adds schema only; it does not set employee PINs or change existing permissions.
ALTER TABLE TDK_POS.staff
  ADD COLUMN IF NOT EXISTS employee_pin_hash VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS hos_enabled TINYINT NOT NULL DEFAULT 0;

SELECT TABLE_SCHEMA, COLUMN_NAME, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'TDK_POS' AND TABLE_NAME = 'staff'
  AND COLUMN_NAME IN ('employee_pin_hash', 'hos_enabled')
ORDER BY COLUMN_NAME;
