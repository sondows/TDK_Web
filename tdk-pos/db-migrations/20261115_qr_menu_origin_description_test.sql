-- Add the freeform Korean origin description for development verification only.
-- Verify the target is TDK_POS_TEST before executing this migration.
USE TDK_POS_TEST;

ALTER TABLE qr_menu_descriptions
  ADD COLUMN origin_description TEXT NULL AFTER detail_description;
