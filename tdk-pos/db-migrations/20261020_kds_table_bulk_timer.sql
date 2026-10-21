-- Additive KDS1 table completion and persisted post-cook timer fields.
-- Apply to TEST first, then production before deploying this code.
-- Existing orders and KDS states are retained. Existing POT menus are opted into
-- the timer selection using their explicit, stable KDS cooking classification.

ALTER TABLE menus
  ADD COLUMN kds_post_cook_timer TINYINT NOT NULL DEFAULT 0 AFTER kds_completion_timer;

UPDATE menus
SET kds_post_cook_timer = 1
WHERE kds_kind = 'POT';

ALTER TABLE kds_tasks
  ADD COLUMN post_cook_timer_minutes TINYINT UNSIGNED NULL AFTER completion_timer,
  ADD COLUMN post_cook_timer_started_at_ms BIGINT UNSIGNED NULL AFTER post_cook_timer_minutes;
