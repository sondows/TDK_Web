-- Apply once to each database used by this deployment (TDK_POS_TEST and TDK_POS).
-- Run while connected to the intended database. Existing rows retain current behavior.
ALTER TABLE `customers`
  ADD COLUMN `uses_fixed_coupon` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_payment_managed`,
  ADD COLUMN `fixed_coupon_amount` DECIMAL(14,2) NULL AFTER `uses_fixed_coupon`;

ALTER TABLE `payments`
  ADD COLUMN `customer_coupon_customer_name_snapshot` VARCHAR(100) NULL AFTER `customer_id`,
  ADD COLUMN `customer_coupon_quantity` INT UNSIGNED NULL AFTER `customer_coupon_customer_name_snapshot`,
  ADD COLUMN `customer_coupon_unit_amount_snapshot` DECIMAL(14,2) NULL AFTER `customer_coupon_quantity`;

ALTER TABLE `payments`
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
