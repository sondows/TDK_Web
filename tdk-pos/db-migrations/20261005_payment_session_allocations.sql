CREATE TABLE IF NOT EXISTS payment_session_allocations (
  payment_id BIGINT UNSIGNED NOT NULL,
  session_id BIGINT UNSIGNED NOT NULL,
  applied_amount DECIMAL(14,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (payment_id, session_id),
  KEY idx_payment_session_allocations_session (session_id),
  CONSTRAINT fk_payment_session_allocations_payment
    FOREIGN KEY (payment_id) REFERENCES payments(payment_id),
  CONSTRAINT fk_payment_session_allocations_session
    FOREIGN KEY (session_id) REFERENCES table_sessions(session_id)
) ENGINE=InnoDB;

-- Backfill payments whose checkout items belong to exactly one session.
-- Legacy multi-session checkouts have no persisted payer session, so their
-- ownership must be reconciled from the source transaction before backfill.
INSERT INTO payment_session_allocations (payment_id, session_id, applied_amount)
SELECT p.payment_id, MIN(o.session_id), p.applied_amount
FROM payments p
JOIN checkout_items ci ON ci.checkout_id = p.checkout_id
JOIN order_items oi ON oi.order_item_id = ci.order_item_id
JOIN orders o ON o.order_id = oi.order_id
WHERE p.status = 'APPROVED'
  AND p.applied_amount > 0
GROUP BY p.payment_id, p.applied_amount
HAVING COUNT(DISTINCT o.session_id) = 1
ON DUPLICATE KEY UPDATE applied_amount = VALUES(applied_amount);
