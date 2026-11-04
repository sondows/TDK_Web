-- Production deployment only after an approved maintenance window.
-- Confirm SELECT DATABASE() = TDK_POS before running. No rows or existing sessions are changed.
ALTER TABLE TDK_POS.staff_sessions
  MODIFY COLUMN session_type ENUM('POS', 'ADMIN', 'KDS', 'HOS') NOT NULL DEFAULT 'POS';

SHOW COLUMNS FROM TDK_POS.staff_sessions LIKE 'session_type';
