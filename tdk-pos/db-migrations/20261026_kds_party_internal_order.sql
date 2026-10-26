-- Apply to TDK_POS_TEST first, then production before deploying code that reads this table.
-- Party-local ranks are isolated from kds_table_order's global ranks.
CREATE TABLE IF NOT EXISTS kds_party_table_order (
  party_group_id BIGINT UNSIGNED NOT NULL,
  session_id BIGINT UNSIGNED NOT NULL,
  sort_order INT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (party_group_id, session_id),
  KEY idx_kds_party_table_order_sort (party_group_id, sort_order, session_id)
) ENGINE=InnoDB;
