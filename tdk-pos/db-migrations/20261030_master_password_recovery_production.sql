-- PRODUCTION DATABASE. Apply only after explicit approval and a verified backup.
USE TDK_POS;

CREATE TABLE IF NOT EXISTS master_password_recovery_grants (
  grant_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (grant_id),
  UNIQUE KEY uq_master_password_recovery_token (token_hash),
  KEY idx_master_password_recovery_staff (staff_id, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT DATABASE() AS db_name;
SHOW TABLES LIKE 'master_password_recovery_grants';
