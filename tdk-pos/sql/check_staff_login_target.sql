-- Read-only audit. Run against the database used by the NAS Docker container.
-- This script does not print PIN hashes or modify any data.
SELECT DATABASE() AS database_name, @@hostname AS server_name, @@port AS server_port, CURRENT_USER() AS connected_account;

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('staff', 'staff_sessions', 'system_settings')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- Run the following only when the columns above exist as expected.
SELECT staff_id, staff_code, name, role, is_active, cancel_requires_pin,
       (pin_hash IS NOT NULL) AS has_pos_pin,
       LEFT(SHA2(pin_hash, 256), 12) AS pos_pin_fingerprint,
       admin_login_id,
       (admin_pin_hash IS NOT NULL) AS has_admin_pin,
       LEFT(SHA2(admin_pin_hash, 256), 12) AS admin_pin_fingerprint
FROM staff
ORDER BY staff_id;

SELECT setting_key, setting_value
FROM system_settings
WHERE setting_key = 'pos_login_mode';

SELECT staff_code, COUNT(*) AS duplicate_count
FROM staff
GROUP BY staff_code
HAVING COUNT(*) > 1;

SELECT admin_login_id, COUNT(*) AS duplicate_count
FROM staff
WHERE admin_login_id IS NOT NULL
GROUP BY admin_login_id
HAVING COUNT(*) > 1;
