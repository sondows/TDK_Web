-- Customer trade-balance payments use the existing payments and ledger tables.
-- Run once; the unique method_code makes a second run harmless.
INSERT INTO `payment_methods` (`method_code`, `method_name`, `method_type`, `is_active`, `sort_order`)
VALUES ('CUSTOMER_PAYMENT', '고객결제', 'CREDIT', 1, 9999)
ON DUPLICATE KEY UPDATE `method_code` = `method_code`;
