-- Preserve the amount received on a card payment separately from the amount
-- applied to the checkout. Existing payments were fully applied before this change.
ALTER TABLE `payments`
  ADD COLUMN `applied_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER `amount`,
  ADD COLUMN `customer_id` BIGINT UNSIGNED NULL AFTER `applied_amount`,
  ADD KEY `idx_payments_customer` (`customer_id`),
  ADD CONSTRAINT `fk_payments_customer`
    FOREIGN KEY (`customer_id`) REFERENCES `customers` (`customer_id`);

UPDATE `payments`
SET `applied_amount` = `amount`
WHERE `applied_amount` = 0.00;

CREATE TABLE `customer_prepaid_ledger` (
  `ledger_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `customer_id` BIGINT UNSIGNED NOT NULL,
  `payment_id` BIGINT UNSIGNED NOT NULL,
  `entry_type` ENUM('CARD_OVERPAYMENT', 'CARD_OVERPAYMENT_REVERSAL') NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL COMMENT 'Signed amount: credit positive, reversal negative',
  `reverses_ledger_id` BIGINT UNSIGNED NULL,
  `created_by_staff_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`ledger_id`),
  KEY `idx_customer_prepaid_ledger_customer_time` (`customer_id`, `created_at`),
  UNIQUE KEY `uq_customer_prepaid_ledger_payment_type` (`payment_id`, `entry_type`),
  UNIQUE KEY `uq_customer_prepaid_ledger_reversal` (`reverses_ledger_id`),
  CONSTRAINT `fk_customer_prepaid_ledger_customer`
    FOREIGN KEY (`customer_id`) REFERENCES `customers` (`customer_id`),
  CONSTRAINT `fk_customer_prepaid_ledger_payment`
    FOREIGN KEY (`payment_id`) REFERENCES `payments` (`payment_id`),
  CONSTRAINT `fk_customer_prepaid_ledger_reverses`
    FOREIGN KEY (`reverses_ledger_id`) REFERENCES `customer_prepaid_ledger` (`ledger_id`),
  CONSTRAINT `fk_customer_prepaid_ledger_staff`
    FOREIGN KEY (`created_by_staff_id`) REFERENCES `staff` (`staff_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
