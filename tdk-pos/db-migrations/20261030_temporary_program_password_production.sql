-- PRODUCTION DATABASE. Apply only after approval and a verified backup.
USE TDK_POS;
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS security_password_change_required TINYINT NOT NULL DEFAULT 0
  AFTER security_password_hash;
SHOW COLUMNS FROM staff LIKE 'security_password_change_required';
