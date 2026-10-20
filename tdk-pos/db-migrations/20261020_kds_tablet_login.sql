-- Run on TDK_POS_TEST first, then TDK_POS before deploying the KDS login code.
-- Additive only: staff credentials, POS sessions, orders and KDS tasks are unchanged.
CREATE TABLE IF NOT EXISTS kds_accounts (
  kds_account_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  login_id VARCHAR(32) NOT NULL,
  pin_hash VARCHAR(255) NOT NULL,
  is_active TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kds_accounts_login_id (login_id)
);

CREATE TABLE IF NOT EXISTS kds_sessions (
  kds_session_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kds_account_id BIGINT UNSIGNED NOT NULL,
  session_token_hash VARCHAR(64) NOT NULL,
  logged_in_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('ACTIVE', 'LOGGED_OUT') NOT NULL DEFAULT 'ACTIVE',
  UNIQUE KEY uq_kds_sessions_token (session_token_hash),
  KEY idx_kds_sessions_account (kds_account_id),
  CONSTRAINT fk_kds_sessions_account FOREIGN KEY (kds_account_id) REFERENCES kds_accounts(kds_account_id)
);
