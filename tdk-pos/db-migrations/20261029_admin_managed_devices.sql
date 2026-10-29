-- Additive KDS authentication and managed-device registry migration.
-- Safe to re-run after a partially completed import: no tables or staff data are reset.
-- Apply to TDK_POS_TEST first. Apply to TDK_POS only after deployment approval.
-- Includes the schema prerequisites from 20261027 and 20261028 because some
-- installations do not yet have kds_trusted_devices.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS kds_enabled TINYINT NOT NULL DEFAULT 0 AFTER pin_hash,
  ADD COLUMN IF NOT EXISTS kds_pin_hash VARCHAR(255) NULL AFTER kds_enabled;

ALTER TABLE staff_sessions
  ADD COLUMN IF NOT EXISTS session_type ENUM('POS', 'ADMIN', 'KDS') NOT NULL DEFAULT 'POS' AFTER logged_out_at;

ALTER TABLE staff_sessions
  MODIFY COLUMN session_type ENUM('POS', 'ADMIN', 'KDS') NOT NULL DEFAULT 'POS';

CREATE TABLE IF NOT EXISTS kds_login_attempts (
  staff_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  window_started_at DATETIME NOT NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS kds_password_hash VARCHAR(255) NULL AFTER kds_pin_hash,
  ADD COLUMN IF NOT EXISTS kds_totp_secret_enc VARCHAR(512) NULL AFTER kds_password_hash,
  ADD COLUMN IF NOT EXISTS kds_totp_pending_secret_enc VARCHAR(512) NULL AFTER kds_totp_secret_enc,
  ADD COLUMN IF NOT EXISTS kds_totp_pending_expires_at DATETIME NULL AFTER kds_totp_pending_secret_enc,
  ADD COLUMN IF NOT EXISTS kds_pin_change_required TINYINT NOT NULL DEFAULT 1 AFTER kds_totp_pending_expires_at;

CREATE TABLE IF NOT EXISTS kds_auth_ip_attempts (
  ip_hash CHAR(64) NOT NULL PRIMARY KEY,
  window_started_at DATETIME NOT NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_kds_auth_ip_updated_at (updated_at)
);

CREATE TABLE IF NOT EXISTS kds_trusted_devices (
  device_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  staff_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  device_label VARCHAR(120) NOT NULL DEFAULT 'KDS device',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  UNIQUE KEY uq_kds_trusted_devices_token_hash (token_hash),
  KEY idx_kds_trusted_devices_staff (staff_id, revoked_at)
);

CREATE TABLE IF NOT EXISTS managed_devices (
  device_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  device_code VARCHAR(24) NULL,
  device_name VARCHAR(120) NOT NULL,
  device_type ENUM('POS', 'KDS') NOT NULL,
  status ENUM('PENDING', 'APPROVED', 'DENIED', 'REVOKED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
  pos_enabled TINYINT NOT NULL DEFAULT 0,
  kds_enabled TINYINT NOT NULL DEFAULT 0,
  token_hash CHAR(64) NULL,
  request_token_hash CHAR(64) NULL,
  confirmation_code CHAR(6) NULL,
  registered_by_staff_id BIGINT UNSIGNED NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  request_expires_at DATETIME NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  expires_at DATETIME NULL,
  revoked_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_managed_devices_code (device_code),
  UNIQUE KEY uq_managed_devices_token_hash (token_hash),
  UNIQUE KEY uq_managed_devices_request_token_hash (request_token_hash),
  KEY idx_managed_devices_status_requested (status, requested_at),
  KEY idx_managed_devices_staff (registered_by_staff_id, device_type)
);

-- Preserve existing KDS device tokens and IDs so active staff_sessions.device_id
-- values remain valid. Grandfather them for at most 30 days so the new approval
-- workflow does not lock out the kitchen immediately after rollout.
INSERT IGNORE INTO managed_devices (
  device_id, device_code, device_name, device_type, status, pos_enabled, kds_enabled,
  token_hash, registered_by_staff_id, requested_at, approved_at, created_at,
  last_used_at, expires_at, revoked_at, updated_at
)
SELECT
  old.device_id,
  CONCAT('KDS-', LPAD(old.device_id, 3, '0')),
  old.device_label,
  'KDS',
  CASE
    WHEN old.revoked_at IS NOT NULL THEN 'REVOKED'
    WHEN old.expires_at <= NOW() THEN 'EXPIRED'
    ELSE 'APPROVED'
  END,
  0, 1, old.token_hash, old.staff_id, old.created_at, old.created_at,
  old.created_at, old.last_used_at,
  LEAST(old.expires_at, DATE_ADD(NOW(), INTERVAL 30 DAY)),
  old.revoked_at, NOW()
FROM kds_trusted_devices old;
