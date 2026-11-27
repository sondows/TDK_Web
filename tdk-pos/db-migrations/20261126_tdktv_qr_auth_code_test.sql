-- TDK_POS_TEST only. Shared rolling 10-second QR verification display state.
USE TDK_POS_TEST;

CREATE TABLE IF NOT EXISTS tv_qr_auth_code_state (
  state_id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  issuance_id CHAR(36) NULL,
  code CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NULL,
  issued_at DATETIME(3) NULL,
  last_requested_at DATETIME(3) NULL,
  expires_at DATETIME(3) NULL,
  state_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tv_qr_auth_code_state (state_id) VALUES (1)
ON DUPLICATE KEY UPDATE state_id = VALUES(state_id);
