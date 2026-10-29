-- Additive security migration for unified ADM access and OWNER-only security tools.
-- Apply to TDK_POS_TEST first. Do not apply to production without explicit approval.
-- This migration never deletes or rewrites existing staff PIN hashes or sessions.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS admin_enabled TINYINT NULL DEFAULT NULL;

-- Preserve access for existing ADM accounts during the staged migration.
UPDATE staff
SET admin_enabled = CASE
  WHEN admin_permission <> 'NONE' AND admin_login_id IS NOT NULL AND admin_pin_hash IS NOT NULL THEN 1
  ELSE 0
END
WHERE admin_enabled IS NULL;

ALTER TABLE staff MODIFY COLUMN admin_enabled TINYINT NOT NULL DEFAULT 0;

ALTER TABLE staff_sessions
  ADD COLUMN IF NOT EXISTS owner_reauthenticated_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS admin_security_settings (
  settings_id TINYINT NOT NULL PRIMARY KEY,
  owner_staff_id BIGINT UNSIGNED NULL,
  owner_security_password_hash VARCHAR(255) NULL,
  device_registration_password_enabled TINYINT NOT NULL DEFAULT 0,
  device_registration_password_hash VARCHAR(255) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_staff_id BIGINT UNSIGNED NULL
);

CREATE TABLE IF NOT EXISTS admin_auth_attempts (
  attempt_key CHAR(64) NOT NULL PRIMARY KEY,
  window_started_at DATETIME NOT NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_admin_auth_attempts_updated_at (updated_at)
);

INSERT IGNORE INTO admin_security_settings (settings_id, owner_staff_id, device_registration_password_enabled)
VALUES (1, NULL, 0);

-- The user-confirmed ADM account for Son Chang-ho is the preferred initial security owner.
-- Resolve its numeric staff_id once and store that value; runtime authorization never uses the
-- login string. Only assign when exactly one active, enabled ADM account matches.
UPDATE admin_security_settings
SET owner_staff_id = (
  SELECT MIN(candidate.staff_id)
  FROM staff AS candidate
  WHERE LOWER(candidate.admin_login_id) = LOWER('sondows')
    AND candidate.is_active = 1 AND candidate.admin_enabled = 1
    AND candidate.admin_enabled = 1 AND candidate.staff_code <> '000'
  HAVING COUNT(*) = 1
)
WHERE settings_id = 1 AND owner_staff_id IS NULL;

-- Otherwise designate automatically only when exactly one active OWNER exists. Ambiguous stores
-- require a reviewed, manual owner_staff_id assignment by a DB administrator before enabling the gate.
UPDATE admin_security_settings
SET owner_staff_id = (
  SELECT MIN(candidate.staff_id)
  FROM staff AS candidate
  WHERE candidate.role = 'OWNER' AND candidate.is_active = 1 AND candidate.staff_code <> '000'
  HAVING COUNT(*) = 1
)
WHERE settings_id = 1 AND owner_staff_id IS NULL;
