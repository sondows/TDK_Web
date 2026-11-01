-- TDKON schema synchronization rollback guidance
-- No production schema DDL was generated or executed in this review, so there
-- is currently no production rollback action.
-- MariaDB DDL implicitly commits; this file is not a transactional rollback.

-- If 06_development_hos_column.sql is later applied to TDK_POS_TEST and an
-- explicitly approved rollback is needed, first inspect permission values:
SELECT COUNT(*) AS non_default_hos_permissions
FROM TDK_POS_TEST.staff WHERE hos_enabled <> 0;

-- Only if that count is zero, the development schema rollback may be reviewed.
-- This is intentionally commented because it drops the HOS permission column:
-- ALTER TABLE TDK_POS_TEST.staff DROP COLUMN hos_enabled;

-- No rollback SQL is supplied for VIEW changes (definitions remain unknown) or
-- managed_devices (existing rows include approved/legacy token data). Do not
-- narrow ENUM values or drop the table until HOS/QRS and historical references
-- have been reviewed and migrated.