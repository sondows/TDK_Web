-- PROPOSAL ONLY. Do not execute before operator approval and a secure backup.
-- Target: TDK_POS on AS5304T-SON, checkouts 260 and 342 only.
-- Run on one connection. Inspect changed_checkouts and all verification queries.
-- COMMIT only when changed_checkouts = 2 and the expected states match.
-- This file ends in ROLLBACK by default, so running it cannot persist the change.

START TRANSACTION;

SELECT checkout_id, total_amount, paid_amount, status, completed_at
FROM checkouts WHERE checkout_id IN (260, 342) ORDER BY checkout_id FOR UPDATE;

SELECT payment_id, checkout_id, payment_method_id, amount, applied_amount,
       customer_id, status, paid_at, cancelled_at
FROM payments WHERE checkout_id IN (260, 342) ORDER BY checkout_id, payment_id FOR UPDATE;

UPDATE checkouts AS c
SET c.status = 'CANCELLED'
WHERE c.checkout_id IN (260, 342)
  AND c.status = 'OPEN'
  AND c.total_amount = 20000.00
  AND c.paid_amount = 0.00
  AND c.completed_at IS NULL
  AND EXISTS (SELECT 1 FROM checkout_items ci WHERE ci.checkout_id = c.checkout_id)
  AND NOT EXISTS (
    SELECT 1 FROM checkout_items ci
    JOIN order_items oi ON oi.order_item_id = ci.order_item_id
    WHERE ci.checkout_id = c.checkout_id
      AND (oi.status <> 'CANCELLED' OR
           (SELECT COALESCE(SUM(oc.cancelled_qty), 0)
            FROM order_item_cancellations oc
            WHERE oc.order_item_id = oi.order_item_id) < oi.qty)
  )
  AND NOT EXISTS (
    SELECT 1 FROM payments p
    WHERE p.checkout_id = c.checkout_id AND p.status <> 'CANCELLED'
  )
  AND NOT EXISTS (
    SELECT 1 FROM customer_prepaid_ledger l
    JOIN payments p ON p.payment_id = l.payment_id
    WHERE p.checkout_id = c.checkout_id
  )
  AND (
    (c.checkout_id = 260
      AND (SELECT COUNT(*) FROM payments p WHERE p.checkout_id = c.checkout_id) = 1
      AND EXISTS (SELECT 1 FROM payments p WHERE p.checkout_id = c.checkout_id
                  AND p.payment_id = 288 AND p.status = 'CANCELLED'
                  AND p.amount = 20000.00 AND p.applied_amount = 20000.00
                  AND p.customer_id IS NULL AND p.cancelled_at IS NOT NULL))
    OR
    (c.checkout_id = 342
      AND (SELECT COUNT(*) FROM payments p WHERE p.checkout_id = c.checkout_id) = 5
      AND (SELECT COUNT(*) FROM payments p WHERE p.checkout_id = c.checkout_id
           AND p.payment_id IN (375, 376, 377, 378, 379)
           AND p.status = 'CANCELLED' AND p.amount = 20000.00
           AND p.applied_amount = 20000.00 AND p.customer_id IS NULL
           AND p.cancelled_at IS NOT NULL) = 5)
  );

SELECT ROW_COUNT() AS changed_checkouts; -- Must be exactly 2; otherwise ROLLBACK.

SELECT c.checkout_id, c.status, c.total_amount, c.paid_amount, c.completed_at,
       COUNT(p.payment_id) AS payment_rows,
       COALESCE(SUM(p.status = 'APPROVED'), 0) AS approved_rows,
       COALESCE(SUM(p.status = 'PENDING'), 0) AS pending_rows,
       COALESCE(SUM(p.status = 'CANCELLED'), 0) AS cancelled_rows
FROM checkouts c LEFT JOIN payments p ON p.checkout_id = c.checkout_id
WHERE c.checkout_id IN (260, 342)
GROUP BY c.checkout_id, c.status, c.total_amount, c.paid_amount, c.completed_at
ORDER BY c.checkout_id;

SELECT checkout_id, status FROM checkouts c
WHERE c.status IN ('OPEN', 'PARTIALLY_PAID')
  AND (c.total_amount > 0 OR EXISTS (
    SELECT 1 FROM payments p WHERE p.checkout_id = c.checkout_id
      AND p.status IN ('APPROVED', 'PENDING')))
ORDER BY checkout_id;

-- Approval-stage execution: replace the following ROLLBACK with COMMIT only
-- after a secure pre-change backup and verification of the results above.
ROLLBACK;
