-- Apply to TDK_POS_TEST first, review results, then apply to TDK_POS only after approval.
-- Preserves the staff row, PIN hashes, orders, payments, and historical staff_id references.
-- Does not drop tables or delete data. Safe to rerun on MariaDB versions supporting IF NOT EXISTS.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS hos_enabled TINYINT NOT NULL DEFAULT 0 AFTER pos_enabled;

-- End any currently active browser sessions for the legacy shared login.
UPDATE staff_sessions AS ss
INNER JOIN staff AS s ON s.staff_id = ss.staff_id
SET ss.status = 'LOGGED_OUT',
    ss.logged_out_at = CURRENT_TIMESTAMP,
    ss.owner_reauthenticated_at = NULL
WHERE s.staff_code = '000'
  AND ss.status = 'ACTIVE';

-- Keep the account and all historical references; disable future use.
UPDATE staff
SET is_active = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE staff_code = '000'
  AND is_active <> 0;

-- Retire a stale setting so older app versions also select employee login.
UPDATE system_settings
SET setting_value = 'PERSONAL', updated_at = CURRENT_TIMESTAMP
WHERE setting_key = 'pos_login_mode'
  AND setting_value <> 'PERSONAL';
