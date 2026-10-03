USE `TDK_POS`;

ALTER TABLE `staff`
  ADD COLUMN `admin_login_id` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL AFTER `pin_hash`,
  ADD COLUMN `admin_pin_hash` VARCHAR(255) NULL DEFAULT NULL AFTER `admin_login_id`,
  ADD UNIQUE KEY `uq_staff_admin_login_id` (`admin_login_id`);
