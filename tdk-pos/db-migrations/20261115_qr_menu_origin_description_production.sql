-- Production rollout SQL only. Do not run as part of deployment or application startup.
-- DBA: run only during an approved schema rollout after independently confirming TDK_POS.
USE TDK_POS;

ALTER TABLE qr_menu_descriptions
  ADD COLUMN origin_description TEXT NULL AFTER detail_description;
