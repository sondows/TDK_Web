-- Additive KDS public-HTTPS authentication migration.
-- Apply to TDK_POS_TEST first, validate, then TDK_POS during a controlled window.
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
