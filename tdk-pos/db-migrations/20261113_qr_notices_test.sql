-- Additive QR notice management schema, pinned to the development database only.
USE TDK_POS_TEST;

CREATE TABLE IF NOT EXISTS qr_notices (
  notice_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  translations_json LONGTEXT NOT NULL,
  is_active TINYINT NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_staff_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (notice_id),
  KEY idx_qr_notices_active_order (is_active, sort_order, notice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
