-- DBA-only, least-privilege grant request for VIEW-definition inspection.
-- Run as a DBA. This grants only SHOW VIEW and only on TDK_POS_TEST.
-- The reviewed effective account was tdk_pos@%; verify the account before use.
-- This file was generated only and has NOT been executed.
GRANT SHOW VIEW ON `TDK_POS_TEST`.* TO 'tdk_pos'@'%';

-- Verify via information_schema.SCHEMA_PRIVILEGES (avoid raw SHOW GRANTS output,
-- which may contain an IDENTIFIED BY PASSWORD verifier):
SELECT GRANTEE, TABLE_SCHEMA, PRIVILEGE_TYPE
FROM information_schema.SCHEMA_PRIVILEGES
WHERE TABLE_SCHEMA='TDK_POS_TEST' AND PRIVILEGE_TYPE='SHOW VIEW'
  AND GRANTEE LIKE '%tdk_pos%'
ORDER BY GRANTEE;

-- After extracting and reviewing the six definitions, an administrator may
-- revoke this temporary database-scoped privilege if no longer needed:
-- REVOKE SHOW VIEW ON `TDK_POS_TEST`.* FROM 'tdk_pos'@'%';