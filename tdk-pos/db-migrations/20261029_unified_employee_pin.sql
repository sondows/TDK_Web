-- Additive migration for the shared employee POS/KDS/HOS PIN.
-- Does not copy, transform, clear, or replace legacy POS/KDS PIN hashes.
-- Apply to TDK_POS_TEST first. Apply to TDK_POS only after explicit approval.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS pos_enabled TINYINT NULL DEFAULT NULL AFTER pin_hash,
  ADD COLUMN IF NOT EXISTS employee_pin_hash VARCHAR(255) NULL AFTER pos_enabled;

-- One-time permission backfill only for rows that did not have an explicit value.
-- Keeps existing POS access that was previously represented by pin_hash presence.
UPDATE staff
SET pos_enabled = CASE WHEN pin_hash IS NOT NULL THEN 1 ELSE 0 END
WHERE pos_enabled IS NULL;

ALTER TABLE staff
  MODIFY COLUMN pos_enabled TINYINT NOT NULL DEFAULT 0;
