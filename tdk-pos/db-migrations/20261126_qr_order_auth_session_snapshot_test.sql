-- Development database only. Preserve all existing QR orders and attempts.
USE TDK_POS_TEST;

ALTER TABLE qr_order_auth_attempts
  ADD COLUMN IF NOT EXISTS table_session_id_at_auth BIGINT UNSIGNED NULL AFTER table_id,
  ADD COLUMN IF NOT EXISTS session_snapshot_recorded TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER table_session_id_at_auth;

-- Existing attempts retain snapshot version 0 and cannot authorize a TV-7C order.
-- New attempts record version 1 and the active DINE_IN session ID (or NULL when none is open).
