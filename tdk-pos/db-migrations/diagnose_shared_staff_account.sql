-- Read-only checks. Run separately against the intended database; no PIN hashes are selected.
SELECT DATABASE() AS database_name;

SELECT staff_id, staff_code, name, is_active, pos_enabled, kds_enabled,
       admin_enabled
FROM staff
WHERE staff_code = '000';

SELECT ss.session_type, ss.status, COUNT(*) AS session_count,
       MAX(ss.logged_in_at) AS last_login_at
FROM staff_sessions AS ss
INNER JOIN staff AS s ON s.staff_id = ss.staff_id
WHERE s.staff_code = '000'
GROUP BY ss.session_type, ss.status
ORDER BY ss.session_type, ss.status;

-- Lists schema-declared foreign-key references to staff; historical rows remain untouched.
SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE REFERENCED_TABLE_SCHEMA = DATABASE()
  AND REFERENCED_TABLE_NAME = 'staff'
ORDER BY TABLE_NAME, COLUMN_NAME;

SELECT setting_key, setting_value
FROM system_settings
WHERE setting_key = 'pos_login_mode';
