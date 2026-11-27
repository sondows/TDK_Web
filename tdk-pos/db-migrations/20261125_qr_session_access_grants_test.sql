-- Development DB only. Confirm SELECT DATABASE() = 'TDK_POS_TEST' before running.
-- MariaDB DDL is not transactional. Inspect SHOW COLUMNS FROM qr_sessions first;
-- skip ALTER entirely when all four columns already exist.
USE TDK_POS_TEST;
-- ALTER TABLE qr_sessions
--   ADD COLUMN access_grant_source ENUM('ORDER_APPROVED','INVITED','LEGACY') NULL,
--   ADD COLUMN access_grant_qr_order_id BIGINT UNSIGNED NULL,
--   ADD COLUMN access_grant_invite_id BIGINT UNSIGNED NULL,
--   ADD COLUMN access_granted_at DATETIME NULL;

-- Direct proof requires the same submitting QR session, accepted order,
-- table-use session, and table. An invitation with only redeemed_at is not
-- sufficient to identify its recipient, so it is deliberately not backfilled.
START TRANSACTION;
UPDATE qr_sessions qs
JOIN table_sessions ts ON ts.session_id = qs.session_id AND ts.table_id = qs.table_id
JOIN (
  SELECT qo.qr_session_id, MIN(qo.qr_order_id) AS qr_order_id
  FROM qr_orders qo
  JOIN orders o ON o.order_id = qo.accepted_order_id
  JOIN qr_sessions source_session ON source_session.qr_session_id = qo.qr_session_id
    AND source_session.session_id = o.session_id
  WHERE qo.status = 'ACCEPTED'
  GROUP BY qo.qr_session_id
) proof ON proof.qr_session_id = qs.qr_session_id
JOIN qr_orders accepted ON accepted.qr_order_id = proof.qr_order_id
SET qs.access_grant_source = 'ORDER_APPROVED',
    qs.access_grant_qr_order_id = proof.qr_order_id,
    qs.access_grant_invite_id = NULL,
    qs.access_granted_at = accepted.accepted_at
WHERE qs.access_grant_source IS NULL;

UPDATE qr_sessions
SET access_grant_source = 'LEGACY', access_grant_qr_order_id = NULL,
    access_grant_invite_id = NULL, access_granted_at = CURRENT_TIMESTAMP
WHERE session_id IS NOT NULL AND access_grant_source IS NULL;
COMMIT;

-- Review counts without exposing tokens or customer identifiers.
SELECT access_grant_source, COUNT(*) AS sessions
FROM qr_sessions GROUP BY access_grant_source;
