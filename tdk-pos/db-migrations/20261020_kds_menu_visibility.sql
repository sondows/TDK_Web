-- Apply after 20261020_kds_v1.sql on TEST, then on production before deployment.
-- Existing menu/KDS behavior is retained until a menu is explicitly switched OFF.
ALTER TABLE menus ADD COLUMN kds_visible TINYINT NOT NULL DEFAULT 1 AFTER kds_completion_timer;

-- Menus already classified as NONE have never generated a KDS cooking task.
-- Show that existing exclusion explicitly as OFF in menu management.
UPDATE menus SET kds_visible=0 WHERE kds_kind='NONE';
