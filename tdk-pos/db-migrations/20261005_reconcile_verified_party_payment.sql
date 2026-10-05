-- One-time repair for the verified T1/T3 party payment in the current POS database.
-- Payment 110 / checkout 61 is documented as the 10,000 payment applied at T1.
-- Run only after 20261005_payment_session_allocations.sql.
INSERT INTO payment_session_allocations (payment_id, session_id, applied_amount)
SELECT p.payment_id, ts.session_id, p.applied_amount
FROM payments p
JOIN checkout_items ci ON ci.checkout_id = p.checkout_id
JOIN order_items oi ON oi.order_item_id = ci.order_item_id
JOIN orders o ON o.order_id = oi.order_id
JOIN table_sessions ts ON ts.session_id = o.session_id
JOIN dining_tables dt ON dt.table_id = ts.table_id
WHERE p.payment_id = 110
  AND p.checkout_id = 61
  AND p.status = 'APPROVED'
  AND p.applied_amount = 10000.00
  AND ts.session_id = 99
  AND dt.table_no = '1'
GROUP BY p.payment_id, ts.session_id, p.applied_amount
ON DUPLICATE KEY UPDATE applied_amount = VALUES(applied_amount);
