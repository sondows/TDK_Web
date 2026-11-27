-- TDK_POS_TEST only. Inspect each column/table before applying; do not run duplicate ALTER statements.
USE TDK_POS_TEST;
ALTER TABLE tv_screens
  ADD COLUMN physical_order INT NOT NULL DEFAULT 1,
  ADD COLUMN layout_x INT NOT NULL DEFAULT 0,
  ADD COLUMN layout_y INT NOT NULL DEFAULT 0;
CREATE TABLE tv_sync_groups (
  group_name VARCHAR(40) NOT NULL PRIMARY KEY,
  interval_seconds INT NOT NULL DEFAULT 10,
  transition_effect ENUM('NONE','FADE','SLIDE','ZOOM') NOT NULL DEFAULT 'FADE',
  epoch_started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
UPDATE tv_screens SET physical_order=1,layout_x=0,layout_y=0 WHERE code='AD-01';
UPDATE tv_screens SET physical_order=2,layout_x=1,layout_y=0 WHERE code='MENU-01';
UPDATE tv_screens SET physical_order=3,layout_x=2,layout_y=0 WHERE code='MENU-02';
UPDATE tv_screens SET physical_order=4,layout_x=3,layout_y=0 WHERE code='MENU-03';
UPDATE tv_screens SET physical_order=5,layout_x=4,layout_y=0 WHERE code='MENU-04';
