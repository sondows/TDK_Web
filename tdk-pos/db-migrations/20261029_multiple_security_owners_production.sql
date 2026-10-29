-- PRODUCTION: do not execute before explicit approval, backup and test verification.
-- Additive and repeatable. Copy the existing designated owner's credential hash without changing it.
SELECT owner_staff_id, IF(owner_security_password_hash IS NULL, 0, 1) AS has_password
FROM TDK_POS.admin_security_settings WHERE settings_id = 1;

CREATE TABLE IF NOT EXISTS TDK_POS.admin_security_owners (
  staff_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  password_hash VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assigned_by_staff_id BIGINT UNSIGNED NULL
);

INSERT IGNORE INTO TDK_POS.admin_security_owners (staff_id, password_hash)
SELECT owner_staff_id, owner_security_password_hash
FROM TDK_POS.admin_security_settings
WHERE settings_id = 1 AND owner_staff_id IS NOT NULL;

SELECT o.staff_id, s.admin_login_id,
       IF(o.password_hash IS NULL, 'SETUP_PENDING', 'ACTIVE') AS status
FROM TDK_POS.admin_security_owners AS o
JOIN TDK_POS.staff AS s ON s.staff_id = o.staff_id
ORDER BY o.staff_id;
