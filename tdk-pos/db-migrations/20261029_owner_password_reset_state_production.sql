-- PRODUCTION: apply only after explicit approval, backup, and successful TEST validation.
-- Additive and repeatable. Existing password hashes and staff data are preserved.
ALTER TABLE TDK_POS.admin_security_owners
  ADD COLUMN IF NOT EXISTS credential_state ENUM('SETUP_PENDING','RESET_REQUIRED','ACTIVE') NOT NULL DEFAULT 'SETUP_PENDING';

-- Backfill only active credentials. Keep RESET_REQUIRED rows unchanged on repeat runs.
UPDATE TDK_POS.admin_security_owners
SET credential_state = 'ACTIVE'
WHERE password_hash IS NOT NULL AND password_hash <> '';

SELECT staff_id, credential_state,
       IF(password_hash IS NULL OR password_hash = '', 0, 1) AS has_password
FROM TDK_POS.admin_security_owners
ORDER BY staff_id;
