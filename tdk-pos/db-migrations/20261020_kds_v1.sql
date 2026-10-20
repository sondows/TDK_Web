-- Apply to TDK_POS_TEST first, then production before deploying the KDS code.
-- Additive only: existing orders, order items, payments and sales are untouched.
ALTER TABLE menus
  ADD COLUMN kds_kind ENUM('NONE','POT','ADDON','SOLO') NOT NULL DEFAULT 'NONE',
  ADD COLUMN kds_group_key VARCHAR(60) NULL,
  ADD COLUMN kds_completion_timer TINYINT NOT NULL DEFAULT 0;

-- Explicitly seed the menu catalog verified on 2026-10-20. New menus default
-- to NONE until their kitchen behavior is configured in menu management.
UPDATE menus SET kds_kind='POT', kds_group_key='STEW', kds_completion_timer=1
WHERE pos_name IN ('흑돼지김치찌개','목살김치찌개','불고기김치찌개','참치김치찌개','꽁치김치찌개');
UPDATE menus SET kds_kind='ADDON', kds_group_key=NULL, kds_completion_timer=0
WHERE pos_name IN ('흑돼지추가','목살추가','불고기추가','참치추가','꽁치추가',
  '두부추가','찌개김치추가','야채추가','날계란');
UPDATE menus SET kds_kind='SOLO', kds_group_key=NULL, kds_completion_timer=0
WHERE pos_name IN ('고등어구이','계란말이','만두사리','햄사리','우동사리','라면사리',
  '공기밥','김가루','도시락김','흑돼지간편포장','목살간편포장',
  '불고기간편포장','참치간편포장','꽁치간편포장','육수포장','반찬포장');

CREATE TABLE IF NOT EXISTS kds_cooking_groups (
  group_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  compatibility_key VARCHAR(80) NOT NULL,
  started_at_ms BIGINT UNSIGNED NOT NULL,
  KEY idx_kds_groups_compatibility_time (compatibility_key, started_at_ms)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS kds_group_mutex (
  mutex_id TINYINT NOT NULL PRIMARY KEY
) ENGINE=InnoDB;
INSERT IGNORE INTO kds_group_mutex (mutex_id) VALUES (1);

CREATE TABLE IF NOT EXISTS kds_sync_cursor (
  cursor_id TINYINT NOT NULL PRIMARY KEY,
  initial_order_id BIGINT UNSIGNED NOT NULL,
  last_order_id BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB;
INSERT IGNORE INTO kds_sync_cursor (cursor_id, initial_order_id, last_order_id)
SELECT 1, COALESCE(MAX(order_id),0), COALESCE(MAX(order_id),0) FROM orders;

CREATE TABLE IF NOT EXISTS kds_tasks (
  task_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  task_key VARCHAR(80) NOT NULL,
  member_items TEXT NOT NULL,
  kind ENUM('POT','SOLO') NOT NULL,
  compatibility_key VARCHAR(80) NOT NULL,
  completion_timer TINYINT NOT NULL DEFAULT 0,
  status ENUM('WAITING','COOKING','DONE') NOT NULL DEFAULT 'WAITING',
  cooking_group_id BIGINT UNSIGNED NULL,
  cooking_started_at_ms BIGINT UNSIGNED NULL,
  cooking_completed_at_ms BIGINT UNSIGNED NULL,
  previous_state TEXT NULL,
  changed_at_ms BIGINT UNSIGNED NULL,
  cancel_acknowledged_at_ms BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_kds_tasks_key (task_key),
  KEY idx_kds_tasks_order (order_id),
  KEY idx_kds_tasks_status (status, task_id),
  CONSTRAINT fk_kds_tasks_order FOREIGN KEY (order_id) REFERENCES orders(order_id),
  CONSTRAINT fk_kds_tasks_group FOREIGN KEY (cooking_group_id) REFERENCES kds_cooking_groups(group_id)
) ENGINE=InnoDB;
