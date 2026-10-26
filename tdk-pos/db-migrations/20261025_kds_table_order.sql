-- Apply to TDK_POS_TEST first, then production before deploying code that reads this table.
-- This additive table stores only the display order for individual KDS sessions.
-- It does not modify table_sessions, party groups, orders, or KDS task state.
CREATE TABLE IF NOT EXISTS kds_table_order (
  session_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  sort_order INT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_kds_table_order_sort (sort_order, session_id)
) ENGINE=InnoDB;
