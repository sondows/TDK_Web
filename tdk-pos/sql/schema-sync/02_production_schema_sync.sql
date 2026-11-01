-- TDKON schema synchronization: production DDL review gate
-- TARGET: TDK_POS
-- STATUS: BLOCKED for production schema DDL generation.
-- Generated for review only; not executed.
-- Do not run a guessed or partial schema sync as if it were complete.

SELECT DATABASE() AS target_database, VERSION() AS mariadb_version;

-- No production DDL is currently approved by this review:
-- 1) staff.hos_enabled exists in PROD but not TEST. Current source uses this
--    permission in staff management and program access checks. Do not DROP it.
--    Use 06_development_hos_column.sql to align TEST to the HOS-aware source/
--    production definition, under a separate approved development DB change.
-- 2) managed_devices has no current runtime API/CRUD references. ORM metadata
--    and old migrations remain, and the table has device/token records in both
--    databases. Its ENUM expansion is deferred, not an execution target.
-- 3) Six TEST VIEW definitions could not be read (SHOW VIEW denied); no
--    CREATE OR REPLACE VIEW statements can be safely generated yet.
-- 4) The 34 column-position differences are name-based consumers only and do
--    not justify column-reordering ALTER statements.

-- Once the prerequisites are resolved, regenerate this file with only exact
-- DDL derived from the verified TDK_POS_TEST definitions. Never drop HOS data,
-- managed device records, or operational rows to force superficial equality.