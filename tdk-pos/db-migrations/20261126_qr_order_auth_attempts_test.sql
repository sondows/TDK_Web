-- TDK_POS_TEST only. Run only after verifying SELECT DATABASE() = 'TDK_POS_TEST'.
-- This migration preserves all existing QR orders and sessions.
CREATE TABLE IF NOT EXISTS qr_table_order_claims (
  table_id BIGINT UNSIGNED NOT NULL,
  representative_qr_session_id BIGINT UNSIGNED NOT NULL,
  first_qr_order_id BIGINT UNSIGNED NOT NULL,
  table_session_id BIGINT UNSIGNED NULL,
  state ENUM('PENDING','CONFIRMED') NOT NULL DEFAULT 'PENDING',
  claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at DATETIME NULL,
  PRIMARY KEY (table_id),
  KEY idx_qr_table_order_claims_session (table_session_id),
  CONSTRAINT fk_qr_claim_table FOREIGN KEY (table_id) REFERENCES dining_tables (table_id),
  CONSTRAINT fk_qr_claim_representative FOREIGN KEY (representative_qr_session_id) REFERENCES qr_sessions (qr_session_id),
  CONSTRAINT fk_qr_claim_first_order FOREIGN KEY (first_qr_order_id) REFERENCES qr_orders (qr_order_id),
  CONSTRAINT fk_qr_claim_visit FOREIGN KEY (table_session_id) REFERENCES table_sessions (session_id),
  CONSTRAINT chk_qr_claim_state CHECK (
    (state = 'PENDING' AND confirmed_at IS NULL) OR
    (state = 'CONFIRMED' AND table_session_id IS NOT NULL AND confirmed_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qr_order_auth_attempts (
  attempt_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  qr_session_id BIGINT UNSIGNED NOT NULL,
  table_id BIGINT UNSIGNED NOT NULL,
  client_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  issuance_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  cart_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  state ENUM('PENDING','VERIFIED','CONSUMED','BLOCKED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  verified_at DATETIME(3) NULL,
  consumed_at DATETIME(3) NULL,
  qr_order_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (attempt_id),
  UNIQUE KEY uq_qr_order_auth_session_request (qr_session_id, client_request_id),
  KEY idx_qr_order_auth_table_created (table_id, created_at),
  KEY idx_qr_order_auth_expiry_state (state, expires_at),
  CONSTRAINT fk_qr_order_auth_session FOREIGN KEY (qr_session_id) REFERENCES qr_sessions (qr_session_id),
  CONSTRAINT fk_qr_order_auth_table FOREIGN KEY (table_id) REFERENCES dining_tables (table_id),
  CONSTRAINT fk_qr_order_auth_order FOREIGN KEY (qr_order_id) REFERENCES qr_orders (qr_order_id),
  CONSTRAINT chk_qr_order_auth_code CHECK (code REGEXP '^[0-9]{2}$'),
  CONSTRAINT chk_qr_order_auth_attempts CHECK (failed_attempts <= 3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
