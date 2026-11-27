-- TDK_POS_TEST only. Confirm SELECT DATABASE() = 'TDK_POS_TEST' and inspect existing table names before running.
-- MariaDB DDL is not rolled back by ROLLBACK. No existing application tables are altered.
USE TDK_POS_TEST;
CREATE TABLE tv_screens (
  screen_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(100) NOT NULL,
  purpose ENUM('MENU','ADVERTISEMENT') NOT NULL,
  width INT NOT NULL DEFAULT 1920,
  height INT NOT NULL DEFAULT 1080,
  is_active TINYINT NOT NULL DEFAULT 1,
  playback_enabled TINYINT NOT NULL DEFAULT 1,
  default_duration_seconds INT NOT NULL DEFAULT 10,
  loop_enabled TINYINT NOT NULL DEFAULT 1,
  sync_group VARCHAR(40) NULL,
  fit_mode ENUM('CONTAIN','COVER') NOT NULL DEFAULT 'CONTAIN',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tv_screens_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tv_images (
  image_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  screen_id BIGINT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(64) NOT NULL,
  mime_type VARCHAR(32) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  width INT NOT NULL,
  height INT NOT NULL,
  sort_order INT NOT NULL,
  duration_seconds INT NOT NULL DEFAULT 10,
  is_active TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tv_images_stored_name (stored_name),
  KEY idx_tv_images_screen_order (screen_id,sort_order),
  CONSTRAINT fk_tv_images_screen FOREIGN KEY (screen_id) REFERENCES tv_screens (screen_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Safe to re-run this seed after both tables have been verified.
INSERT INTO tv_screens (code,name,purpose) VALUES
  ('DP2','DP2','MENU'),('DP3','DP3','MENU'),
  ('DP4','DP4','MENU'),('DP5','DP5','MENU'),
  ('DP1','DP1','ADVERTISEMENT')
ON DUPLICATE KEY UPDATE code=code;
