-- Run manually in phpMyAdmin after confirming the target database.
-- The customers table was absent when this SQL was prepared.
USE `TDK_POS`;

CREATE TABLE `customers` (
  `customer_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `contact_name` VARCHAR(100) NULL DEFAULT NULL,
  `phone` VARCHAR(30) NULL DEFAULT NULL,
  `email` VARCHAR(255) NULL DEFAULT NULL,
  `memo` TEXT NULL,
  `is_payment_managed` TINYINT(1) NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`customer_id`),
  KEY `idx_customers_name` (`name`),
  KEY `idx_customers_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
