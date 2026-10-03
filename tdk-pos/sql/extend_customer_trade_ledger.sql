-- Run once against TDK_POS before deploying the customer trade management UI.
-- Existing overpayment and reversal rows remain unchanged.
ALTER TABLE `customer_prepaid_ledger`
  MODIFY COLUMN `payment_id` BIGINT UNSIGNED NULL,
  MODIFY COLUMN `entry_type` ENUM(
    'CARD_OVERPAYMENT',
    'CARD_OVERPAYMENT_REVERSAL',
    'PAYMENT_OVERPAYMENT',
    'PAYMENT_OVERPAYMENT_REVERSAL',
    'DEPOSIT',
    'REFUND',
    'ADJUSTMENT',
    'CUSTOMER_PAYMENT',
    'CUSTOMER_PAYMENT_REVERSAL'
  ) NOT NULL,
  ADD COLUMN `transaction_at` DATETIME NULL AFTER `amount`,
  ADD COLUMN `method_code` VARCHAR(20) NULL AFTER `transaction_at`,
  ADD COLUMN `adjustment_reason` VARCHAR(100) NULL AFTER `method_code`,
  ADD COLUMN `memo` VARCHAR(500) NULL AFTER `adjustment_reason`,
  ADD COLUMN `request_key` VARCHAR(36) NULL AFTER `memo`,
  ADD KEY `idx_customer_prepaid_ledger_customer_transaction` (`customer_id`, `transaction_at`, `ledger_id`),
  ADD UNIQUE KEY `uq_customer_prepaid_ledger_request` (`request_key`);

-- Preserve the historical transaction time of all pre-existing POS ledger rows.
UPDATE `customer_prepaid_ledger`
SET `transaction_at` = `created_at`
WHERE `transaction_at` IS NULL;

ALTER TABLE `customer_prepaid_ledger`
  MODIFY COLUMN `transaction_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
