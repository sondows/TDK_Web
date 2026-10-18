-- Apply only after SELECT COUNT(*) FROM table_sessions WHERE status='OPEN' returns 0.
-- Existing table sessions and sales are intentionally left unassigned.
-- Use the same database/user timezone as the existing POS (Asia/Seoul) for DATETIME values.
CREATE TABLE business_session_mutex (
  mutex_id TINYINT NOT NULL PRIMARY KEY
) ENGINE=InnoDB;
INSERT INTO business_session_mutex (mutex_id) VALUES (1);

CREATE TABLE business_sessions (
  business_session_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_date DATE NOT NULL,
  status ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
  open_guard TINYINT NULL,
  cutoff_time VARCHAR(5) NOT NULL,
  opening_cash_enabled TINYINT NOT NULL DEFAULT 0,
  opening_cash DECIMAL(14,2) NULL,
  opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME NULL,
  closed_by_staff_id BIGINT UNSIGNED NULL,
  expected_cash DECIMAL(14,2) NULL,
  actual_cash DECIMAL(14,2) NULL,
  cash_difference DECIMAL(14,2) NULL,
  closing_snapshot TEXT NULL,
  UNIQUE KEY uq_business_sessions_one_open (open_guard),
  KEY idx_business_sessions_date (business_date, business_session_id),
  CONSTRAINT fk_business_sessions_closed_staff FOREIGN KEY (closed_by_staff_id) REFERENCES staff(staff_id),
  CONSTRAINT chk_business_sessions_open_guard CHECK ((status = 'OPEN' AND open_guard = 1) OR (status = 'CLOSED' AND open_guard IS NULL))
) ENGINE=InnoDB;

ALTER TABLE table_sessions
  ADD COLUMN business_session_id BIGINT UNSIGNED NULL,
  ADD KEY idx_table_sessions_business_session (business_session_id),
  ADD CONSTRAINT fk_table_sessions_business_session FOREIGN KEY (business_session_id) REFERENCES business_sessions(business_session_id);
