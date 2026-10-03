-- Allow overpayment credits and reversals from every tender method.
-- Legacy CARD_* values remain readable and existing ledger rows are preserved.
ALTER TABLE `customer_prepaid_ledger`
  MODIFY COLUMN `entry_type` ENUM(
    'CARD_OVERPAYMENT',
    'CARD_OVERPAYMENT_REVERSAL',
    'PAYMENT_OVERPAYMENT',
    'PAYMENT_OVERPAYMENT_REVERSAL'
  ) NOT NULL;
