-- TEST DATABASE ONLY. Additive; existing employee hashes and permissions remain unchanged.
USE TDK_POS_TEST;
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS security_password_change_required TINYINT NOT NULL DEFAULT 0
  AFTER security_password_hash;
SHOW COLUMNS FROM staff LIKE 'security_password_change_required';
