-- Apply to TDK_POS_TEST first. Existing dine-in rows keep their table_id and
-- receive the DINE_IN default. No historical rows are rewritten or deleted.
ALTER TABLE table_sessions
  MODIFY COLUMN table_id BIGINT UNSIGNED NULL,
  ADD COLUMN session_kind ENUM('DINE_IN', 'TAKEOUT_WALK_IN', 'TAKEOUT_PHONE') NOT NULL DEFAULT 'DINE_IN',
  ADD COLUMN display_name VARCHAR(100) NULL,
  ADD COLUMN takeout_label_key VARCHAR(40) NULL,
  ADD COLUMN create_request_key VARCHAR(36) NULL,
  ADD COLUMN pickup_name VARCHAR(100) NULL,
  ADD COLUMN pickup_phone VARCHAR(30) NULL,
  ADD COLUMN pickup_at DATETIME NULL,
  ADD UNIQUE KEY uq_table_sessions_takeout_label_key (takeout_label_key),
  ADD UNIQUE KEY uq_table_sessions_create_request_key (create_request_key),
  ADD KEY idx_table_sessions_kind_status (session_kind, status);
