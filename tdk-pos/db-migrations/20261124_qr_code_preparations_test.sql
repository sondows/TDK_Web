CREATE TABLE IF NOT EXISTS qr_code_preparations (
  qr_code_id BIGINT UNSIGNED NOT NULL,
  table_id BIGINT UNSIGNED NOT NULL,
  prepared_by_staff_id BIGINT UNSIGNED NOT NULL,
  prepared_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (qr_code_id),
  UNIQUE KEY uq_qr_code_preparations_table (table_id),
  CONSTRAINT fk_qr_code_preparations_qr FOREIGN KEY (qr_code_id) REFERENCES qr_codes (qr_code_id),
  CONSTRAINT fk_qr_code_preparations_table FOREIGN KEY (table_id) REFERENCES dining_tables (table_id),
  CONSTRAINT fk_qr_code_preparations_staff FOREIGN KEY (prepared_by_staff_id) REFERENCES staff (staff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
