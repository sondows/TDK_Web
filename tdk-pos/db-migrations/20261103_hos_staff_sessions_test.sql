-- Development DB only. Run manually after confirming SELECT DATABASE() = TDK_POS_TEST.
-- Adds the HOS value to the existing employee session discriminator; creates no table and changes no rows.
ALTER TABLE TDK_POS_TEST.staff_sessions
  MODIFY COLUMN session_type ENUM('POS', 'ADMIN', 'KDS', 'HOS') NOT NULL DEFAULT 'POS';

SHOW COLUMNS FROM TDK_POS_TEST.staff_sessions LIKE 'session_type';
