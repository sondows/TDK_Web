-- Proposal only. Do not run until the per-customer postpaid policy is approved.
-- Existing customers default to prepaid-only; no balances or ledger rows change.
ALTER TABLE `customers`
  ADD COLUMN `allow_postpaid` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_payment_managed`;
