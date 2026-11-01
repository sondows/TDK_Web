-- Additive authentication lifecycle migration. Preserve staff, PIN hashes, owners, tokens and history.
USE TDK_POS;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS terminated_at DATETIME NULL;

ALTER TABLE program_trust_tokens
  ADD COLUMN IF NOT EXISTS client_label VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS revoke_reason VARCHAR(100) NULL;

CREATE TABLE IF NOT EXISTS staff_security_invites (
  invite_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_id BIGINT UNSIGNED NOT NULL,
  invite_hash VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_staff_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (invite_id),
  UNIQUE KEY uq_staff_security_invites_hash (invite_hash),
  KEY idx_staff_security_invites_staff (staff_id, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS security_bootstrap_state (
  state_id TINYINT NOT NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (state_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Existing deployments are permanently marked initialized. Never reopen setup when an owner leaves.
INSERT INTO security_bootstrap_state (state_id, completed_at)
SELECT 1,
  IF(EXISTS(SELECT 1 FROM admin_security_owners)
     OR EXISTS(SELECT 1 FROM staff WHERE staff_code <> '000')
     OR EXISTS(SELECT 1 FROM admin_security_settings WHERE owner_staff_id IS NOT NULL),
     NOW(), NULL)
ON DUPLICATE KEY UPDATE completed_at = COALESCE(completed_at, VALUES(completed_at));

SELECT DATABASE() AS db_name;
SELECT state_id, IF(completed_at IS NULL, 0, 1) AS initialization_complete FROM security_bootstrap_state WHERE state_id=1;
SHOW COLUMNS FROM staff WHERE Field='terminated_at';
SHOW COLUMNS FROM program_trust_tokens WHERE Field IN ('client_label','revoke_reason');
SHOW TABLES LIKE 'staff_security_invites';
