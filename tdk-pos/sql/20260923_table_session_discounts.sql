CREATE TABLE IF NOT EXISTS table_session_discounts (
  table_session_discount_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id BIGINT UNSIGNED NOT NULL,
  discount_type ENUM('SNS_REVIEW', 'AMOUNT', 'PERCENT') NOT NULL,
  label VARCHAR(100) NOT NULL,
  discount_amount DECIMAL(14,2) NOT NULL,
  discount_rate INT NULL,
  applied_by_staff_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (table_session_discount_id),
  KEY idx_table_session_discounts_session (session_id, created_at),
  CONSTRAINT fk_table_session_discounts_session
    FOREIGN KEY (session_id) REFERENCES table_sessions(session_id),
  CONSTRAINT fk_table_session_discounts_staff
    FOREIGN KEY (applied_by_staff_id) REFERENCES staff(staff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
