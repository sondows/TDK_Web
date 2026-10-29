-- Apply after 20261029_admin_managed_devices.sql, first to TDK_POS_TEST.
-- Additive expansion. Existing POS/KDS enum positions, IDs, tokens and permissions remain unchanged.
-- Apply to TDK_POS only after explicit production approval.

ALTER TABLE managed_devices
  MODIFY COLUMN device_type ENUM('POS', 'KDS', 'ADM', 'HOS') NOT NULL,
  ADD COLUMN IF NOT EXISTS adm_enabled TINYINT NOT NULL DEFAULT 0 AFTER kds_enabled,
  ADD COLUMN IF NOT EXISTS hos_enabled TINYINT NOT NULL DEFAULT 0 AFTER adm_enabled;
