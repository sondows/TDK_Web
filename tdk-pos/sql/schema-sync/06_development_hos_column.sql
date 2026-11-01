-- Development-only preparation to align staff HOS schema with the verified
-- production column and current source. Generated only; not executed.
-- TARGET: TDK_POS_TEST. This does not touch employee rows or authentication data.
SELECT DATABASE() AS connected_database, VERSION() AS mariadb_version;
SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,ORDINAL_POSITION,
       COLUMN_COMMENT,EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='TDK_POS' AND TABLE_NAME='staff' AND COLUMN_NAME='hos_enabled';
SELECT COUNT(*) AS hos_column_exists
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='TDK_POS_TEST' AND TABLE_NAME='staff' AND COLUMN_NAME='hos_enabled';

-- Verified production definition: TINYINT(4) NOT NULL DEFAULT 0,
-- blank COMMENT, no EXTRA attribute and no index. Position is 23 in PROD;
-- position differences are non-functional and are intentionally not aligned.
-- Add after employee_pin_hash for a stable, readable placement in TEST.
ALTER TABLE TDK_POS_TEST.staff
  ADD COLUMN IF NOT EXISTS hos_enabled TINYINT(4) NOT NULL DEFAULT 0 COMMENT ''
  AFTER employee_pin_hash;

-- Verify after a separately approved execution:
SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,ORDINAL_POSITION,
       COLUMN_COMMENT,EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='TDK_POS_TEST' AND TABLE_NAME='staff' AND COLUMN_NAME='hos_enabled';