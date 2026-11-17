-- Additive QR menu copy and origin schema for development verification only.
-- Verify the target is TDK_POS_TEST before executing this migration.
USE TDK_POS_TEST;

CREATE TABLE IF NOT EXISTS qr_menu_descriptions (
  menu_id BIGINT UNSIGNED NOT NULL,
  locale_code VARCHAR(5) NOT NULL DEFAULT 'ko',
  short_description VARCHAR(1000) NOT NULL DEFAULT '',
  detail_description TEXT NOT NULL,
  updated_by_staff_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (menu_id, locale_code),
  CONSTRAINT fk_qr_menu_descriptions_menu FOREIGN KEY (menu_id)
    REFERENCES menus (menu_id) ON DELETE CASCADE,
  CONSTRAINT fk_qr_menu_descriptions_staff FOREIGN KEY (updated_by_staff_id)
    REFERENCES staff (staff_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qr_menu_origin_items (
  origin_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  menu_id BIGINT UNSIGNED NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  updated_by_staff_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (origin_id),
  KEY idx_qr_menu_origin_items_menu_order (menu_id, sort_order, origin_id),
  CONSTRAINT fk_qr_menu_origin_items_menu FOREIGN KEY (menu_id)
    REFERENCES menus (menu_id) ON DELETE CASCADE,
  CONSTRAINT fk_qr_menu_origin_items_staff FOREIGN KEY (updated_by_staff_id)
    REFERENCES staff (staff_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qr_menu_origin_translations (
  origin_id BIGINT UNSIGNED NOT NULL,
  locale_code VARCHAR(5) NOT NULL DEFAULT 'ko',
  ingredient_name VARCHAR(120) NOT NULL,
  origin_text VARCHAR(200) NOT NULL,
  updated_by_staff_id BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (origin_id, locale_code),
  CONSTRAINT fk_qr_menu_origin_translations_item FOREIGN KEY (origin_id)
    REFERENCES qr_menu_origin_items (origin_id) ON DELETE CASCADE,
  CONSTRAINT fk_qr_menu_origin_translations_staff FOREIGN KEY (updated_by_staff_id)
    REFERENCES staff (staff_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SHOW TABLES LIKE 'qr_menu_%';
