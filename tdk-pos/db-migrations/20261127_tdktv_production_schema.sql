-- TDK_POS production TV schema migration.
-- Run only after reviewing 20261127_tdktv_production_preflight.sql and taking a backup.
-- MariaDB DDL implicitly commits. This file is designed for safe reruns on MariaDB
-- versions supporting ADD COLUMN IF NOT EXISTS. It changes only tv_screens metadata
-- and creates two TV-only state tables. It does not insert a default notice/group.
USE TDK_POS;

ALTER TABLE tv_screens
  ADD COLUMN IF NOT EXISTS transition_effect ENUM('NONE','FADE','SLIDE','ZOOM') NOT NULL DEFAULT 'FADE',
  ADD COLUMN IF NOT EXISTS physical_order INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS layout_x INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS layout_y INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS tv_sync_groups (
  group_name VARCHAR(40) NOT NULL,
  interval_seconds INT NOT NULL DEFAULT 10,
  transition_effect ENUM('NONE','FADE','SLIDE','ZOOM') NOT NULL DEFAULT 'FADE',
  epoch_started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tv_business_notice (
  notice_id TINYINT NOT NULL,
  is_active TINYINT NOT NULL DEFAULT 0,
  target_code VARCHAR(3) NULL,
  message VARCHAR(1000) NULL,
  started_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Preserve each row's screen_id, purpose, name, playback settings, images and events.
-- The preflight must confirm the expected ID/source-code/purpose pairs and no DP collision.
UPDATE tv_screens SET code='DP1' WHERE screen_id=5 AND code='AD-01' AND purpose='ADVERTISEMENT';
UPDATE tv_screens SET code='DP2' WHERE screen_id=1 AND code='MENU-01' AND purpose='MENU';
UPDATE tv_screens SET code='DP3' WHERE screen_id=2 AND code='MENU-02' AND purpose='MENU';
UPDATE tv_screens SET code='DP4' WHERE screen_id=3 AND code='MENU-03' AND purpose='MENU';
UPDATE tv_screens SET code='DP5' WHERE screen_id=4 AND code='MENU-04' AND purpose='MENU';
