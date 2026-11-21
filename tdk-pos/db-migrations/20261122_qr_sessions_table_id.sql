-- Production schema repair for QR table/session association.
-- Precondition: qr_sessions.table_id does not exist, and dining_tables.table_id
-- is BIGINT UNSIGNED PRIMARY KEY. Existing qr_sessions rows are preserved;
-- their new table_id remains NULL until new sessions are created.
-- Verify the target database is TDK_POS before applying, and apply once.
ALTER TABLE qr_sessions
  ADD COLUMN table_id BIGINT UNSIGNED NULL AFTER session_id,
  ADD KEY idx_qr_sessions_table_status (table_id, status),
  ADD CONSTRAINT fk_qr_sessions_dining_table
    FOREIGN KEY (table_id) REFERENCES dining_tables(table_id);
