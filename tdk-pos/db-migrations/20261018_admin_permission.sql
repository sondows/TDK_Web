-- Apply to TDK_POS_TEST first, then TDK_POS with a schema owner account.
-- Capture whether this is the initial migration so a later rerun cannot promote
-- accounts intentionally changed to NONE or READ_ONLY back to READ_WRITE.
SET @tdk_admin_permission_existed = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'staff' AND column_name = 'admin_permission'
);

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS admin_permission ENUM('NONE', 'READ_ONLY', 'READ_WRITE') NOT NULL DEFAULT 'NONE' AFTER admin_pin_hash;

UPDATE staff
SET admin_permission = 'READ_WRITE'
WHERE @tdk_admin_permission_existed = 0
  AND is_active = 1
  AND staff_code <> '000'
  AND admin_login_id IS NOT NULL
  AND admin_pin_hash IS NOT NULL;
