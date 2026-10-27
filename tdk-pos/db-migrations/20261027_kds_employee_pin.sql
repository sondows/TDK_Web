-- Apply to TDK_POS_TEST first, verify, then apply to TDK_POS before deploying KDS auth.
-- Additive only. KDS is disabled for every employee until an owner assigns access and a PIN.
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS kds_enabled TINYINT NOT NULL DEFAULT 0 AFTER pin_hash,
  ADD COLUMN IF NOT EXISTS kds_pin_hash VARCHAR(255) NULL AFTER kds_enabled;

ALTER TABLE staff_sessions
  ADD COLUMN IF NOT EXISTS session_type ENUM('POS', 'ADMIN', 'KDS') NOT NULL DEFAULT 'POS' AFTER logged_out_at;

CREATE TABLE IF NOT EXISTS kds_login_attempts (
  staff_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  window_started_at DATETIME NOT NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
