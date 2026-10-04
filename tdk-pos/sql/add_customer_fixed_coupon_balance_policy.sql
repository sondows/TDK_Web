-- Run after add_customer_fixed_coupons.sql on each deployment database.
-- The per-customer options match payment_method_settings' existing voucher rules.
ALTER TABLE `customers`
  ADD COLUMN `fixed_coupon_balance_policy` ENUM('CASH_CHANGE','FORFEIT') NOT NULL DEFAULT 'FORFEIT' AFTER `fixed_coupon_amount`,
  ADD COLUMN `fixed_coupon_cash_change_enabled` TINYINT(1) NOT NULL DEFAULT 0 AFTER `fixed_coupon_balance_policy`,
  ADD COLUMN `fixed_coupon_cash_change_min_percent` TINYINT UNSIGNED NULL DEFAULT NULL AFTER `fixed_coupon_cash_change_enabled`;

-- Preserve face value and applied amount separately for fixed coupons.
ALTER TABLE `payments`
  DROP CONSTRAINT `chk_payments_customer_coupon_snapshot`,
  ADD CONSTRAINT `chk_payments_customer_coupon_snapshot` CHECK (
    (
      `customer_coupon_customer_name_snapshot` IS NULL
      AND `customer_coupon_quantity` IS NULL
      AND `customer_coupon_unit_amount_snapshot` IS NULL
    )
    OR (
      `customer_id` IS NOT NULL
      AND `customer_coupon_customer_name_snapshot` IS NOT NULL
      AND `customer_coupon_quantity` > 0
      AND `customer_coupon_unit_amount_snapshot` > 0
      AND `amount` = `customer_coupon_quantity` * `customer_coupon_unit_amount_snapshot`
      AND `applied_amount` <= `amount`
    )
  );
