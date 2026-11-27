-- Development database only. Verify SELECT DATABASE() returns TDK_POS_TEST before execution.
-- Do not run against TDK_POS. MariaDB DDL cannot be rolled back with ROLLBACK.
CREATE TABLE qr_table_order_claims (
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
