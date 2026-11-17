-- Prepared production schema only. Do not run during development verification.
-- DBA: apply only in an approved production schema rollout after confirming TDK_POS.
USE TDK_POS;

ALTER TABLE modifier_options
  ADD COLUMN qr_description VARCHAR(300) NOT NULL DEFAULT '' AFTER pos_name;

SHOW COLUMNS FROM modifier_options LIKE 'qr_description';
