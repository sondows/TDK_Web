-- Additive QR-only option descriptions for development verification.
-- Confirm the selected database is TDK_POS_TEST before running.
USE TDK_POS_TEST;

ALTER TABLE modifier_options
  ADD COLUMN qr_description VARCHAR(300) NOT NULL DEFAULT '' AFTER pos_name;

SHOW COLUMNS FROM modifier_options LIKE 'qr_description';
