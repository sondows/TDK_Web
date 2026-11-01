-- Apply to the test database first. No existing rows or credential hashes are changed.
USE TDK_POS_TEST;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS security_password_hash VARCHAR(255) NULL;

CREATE TABLE IF NOT EXISTS program_trust_tokens (
  token_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  program ENUM('POS','ADM','KDS','HOS') NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  enrolled_by_staff_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  revoked_at DATETIME NULL,
  PRIMARY KEY (token_id),
  UNIQUE KEY uq_program_trust_tokens_hash (token_hash),
  KEY idx_program_trust_tokens_program (program, revoked_at),
  KEY idx_program_trust_tokens_staff (enrolled_by_staff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE staff_sessions
  ADD COLUMN IF NOT EXISTS trust_token_id BIGINT UNSIGNED NULL,
  ADD INDEX IF NOT EXISTS idx_staff_sessions_trust_token (trust_token_id);

SELECT DATABASE() AS db_name;
SHOW COLUMNS FROM staff WHERE Field = 'security_password_hash';
SHOW COLUMNS FROM staff_sessions WHERE Field = 'trust_token_id';
SHOW TABLES LIKE 'program_trust_tokens';
