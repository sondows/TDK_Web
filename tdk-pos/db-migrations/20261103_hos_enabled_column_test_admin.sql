-- DBA ONLY: development database TDK_POS_TEST.
-- Do not run this file against TDK_POS or on a production NAS.
-- This adds one permission column, default OFF. It does not enable HOS for any employee.
-- Existing staff/session rows, credentials, and session_type are not updated.
--
-- Step 1: Run the preflight query and stop unless actual_database = TDK_POS_TEST.
SELECT DATABASE() AS actual_database;

-- Step 2: Run only after confirming the result above is TDK_POS_TEST.
-- MariaDB 10.11: idempotent if the column already exists.
ALTER TABLE TDK_POS_TEST.staff
  ADD COLUMN IF NOT EXISTS hos_enabled TINYINT NOT NULL DEFAULT 0;

-- Step 3: Confirm exact column definition and that every existing staff row defaults OFF.
SHOW COLUMNS FROM TDK_POS_TEST.staff LIKE 'hos_enabled';
SELECT COUNT(*) AS staff_rows,
       SUM(hos_enabled = 0) AS hos_disabled_rows,
       SUM(hos_enabled = 1) AS hos_enabled_rows
FROM TDK_POS_TEST.staff;

-- Expected for the current schema: hos_enabled TINYINT(4) NOT NULL DEFAULT 0;
-- Do not set hos_enabled=1 here. Grant HOS only to a separately identified test employee
-- after the DBA migration has been verified and a test account is approved.
