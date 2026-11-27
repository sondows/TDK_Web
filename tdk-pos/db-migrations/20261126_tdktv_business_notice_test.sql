-- TDK_POS_TEST only. Singleton server-side TV business notice state.
USE TDK_POS_TEST;
CREATE TABLE tv_business_notice (
  notice_id TINYINT NOT NULL PRIMARY KEY,
  is_active TINYINT NOT NULL DEFAULT 0,
  target_code VARCHAR(3) NULL,
  message VARCHAR(1000) NULL,
  started_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO tv_business_notice (notice_id,is_active) VALUES (1,0);
