-- NULL keeps pre-existing payment methods on their original balance policy.
-- Newly saved methods use 0 (off) or 1 (on), with an integer 0..100 percent.
ALTER TABLE `payment_method_settings`
  ADD COLUMN `cash_change_enabled` TINYINT(1) NULL DEFAULT NULL AFTER `balance_policy`,
  ADD COLUMN `cash_change_min_percent` TINYINT UNSIGNED NULL DEFAULT NULL AFTER `cash_change_enabled`;

-- Historical payments remain unchanged; new rows snapshot the rule at payment time.
ALTER TABLE `payment_other_details`
  ADD COLUMN `cash_change_enabled_snapshot` TINYINT(1) NULL DEFAULT NULL AFTER `balance_policy_snapshot`,
  ADD COLUMN `cash_change_min_percent_snapshot` TINYINT UNSIGNED NULL DEFAULT NULL AFTER `cash_change_enabled_snapshot`;
