-- Amount-input methods may return cash only when that method explicitly enabled
-- cash change and the amount applied meets its saved threshold.
-- Existing quantity-input rules and historical rows remain valid.
ALTER TABLE `payment_other_details`
  DROP CONSTRAINT `chk_payment_other_details_input`,
  ADD CONSTRAINT `chk_payment_other_details_input` CHECK (
    (
      `input_type_snapshot` = 'AMOUNT'
      AND `quantity` IS NULL
      AND `unit_amount_snapshot` IS NULL
      AND `balance_policy_snapshot` IS NULL
      AND `forfeited_amount` = 0
      AND (
        `cash_change_amount` = 0
        OR (
          `cash_change_enabled_snapshot` = 1
          AND `cash_change_min_percent_snapshot` IS NOT NULL
          AND `cash_change_min_percent_snapshot` <= 100
          AND `applied_amount` * 100 >= `submitted_amount` * `cash_change_min_percent_snapshot`
        )
      )
    )
    OR (
      `input_type_snapshot` = 'QUANTITY'
      AND `quantity` > 0
      AND `unit_amount_snapshot` > 0
      AND `balance_policy_snapshot` IS NOT NULL
      AND `submitted_amount` = `quantity` * `unit_amount_snapshot`
      AND (
        (`balance_policy_snapshot` = 'CASH_CHANGE' AND `forfeited_amount` = 0)
        OR (`balance_policy_snapshot` = 'FORFEIT' AND `cash_change_amount` = 0)
      )
    )
  );
