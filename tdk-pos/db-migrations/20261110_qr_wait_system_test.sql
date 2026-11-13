-- Additive QR visit/analytics/wait-order schema. This script is explicitly pinned to the test DB.
USE TDK_POS_TEST;

CREATE TABLE IF NOT EXISTS qr_visit_sessions (
  visitor_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  token_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  PRIMARY KEY (visitor_id),
  UNIQUE KEY uq_qr_visit_token_hash (token_hash),
  KEY idx_qr_visit_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qr_wait_orders (
  wait_order_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  visitor_id BIGINT UNSIGNED NOT NULL,
  client_request_id CHAR(36) NOT NULL,
  public_reference VARCHAR(16) NOT NULL,
  access_token_hash CHAR(64) NOT NULL,
  status ENUM('PENDING','ASSIGNED','CONFIRMED','CANCELLED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  estimated_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  assigned_session_id BIGINT UNSIGNED NULL,
  assigned_by_staff_id BIGINT UNSIGNED NULL,
  accepted_order_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  confirmed_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  PRIMARY KEY (wait_order_id),
  UNIQUE KEY uq_qr_wait_visitor_request (visitor_id, client_request_id),
  UNIQUE KEY uq_qr_wait_client_request (client_request_id),
  UNIQUE KEY uq_qr_wait_public_reference (public_reference),
  UNIQUE KEY uq_qr_wait_access_token_hash (access_token_hash),
  UNIQUE KEY uq_qr_wait_accepted_order (accepted_order_id),
  KEY idx_qr_wait_status_created (status, created_at),
  KEY idx_qr_wait_visitor_created (visitor_id, created_at),
  KEY idx_qr_wait_expires (expires_at),
  CONSTRAINT fk_qr_wait_visitor FOREIGN KEY (visitor_id) REFERENCES qr_visit_sessions(visitor_id),
  CONSTRAINT fk_qr_wait_session FOREIGN KEY (assigned_session_id) REFERENCES table_sessions(session_id),
  CONSTRAINT fk_qr_wait_staff FOREIGN KEY (assigned_by_staff_id) REFERENCES staff(staff_id),
  CONSTRAINT fk_qr_wait_accepted_order FOREIGN KEY (accepted_order_id) REFERENCES orders(order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qr_wait_order_items (
  wait_order_item_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wait_order_id BIGINT UNSIGNED NOT NULL,
  menu_id BIGINT UNSIGNED NOT NULL,
  item_name VARCHAR(200) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  option_ids_json TEXT NOT NULL,
  estimated_unit_price DECIMAL(14,2) NOT NULL,
  estimated_line_total DECIMAL(14,2) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (wait_order_item_id),
  KEY idx_qr_wait_order_item_order (wait_order_id, sort_order, wait_order_item_id),
  KEY idx_qr_wait_order_item_menu (menu_id),
  CONSTRAINT fk_qr_wait_item_order FOREIGN KEY (wait_order_id) REFERENCES qr_wait_orders(wait_order_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qr_visit_events (
  visit_event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  visitor_id BIGINT UNSIGNED NOT NULL,
  wait_order_id BIGINT UNSIGNED NULL,
  order_id BIGINT UNSIGNED NULL,
  client_event_id CHAR(36) NOT NULL,
  source ENUM('FRONT','WAITING','TABLE') NOT NULL,
  event_type ENUM('VISIT','MENU_VIEW','ADD','INCREASE','DECREASE','REMOVE','CONVERT_WAIT','CONVERT_TABLE','ORDER_CONFIRMED','WAIT_CANCELLED') NOT NULL,
  menu_id BIGINT UNSIGNED NULL,
  option_ids_json TEXT NOT NULL,
  quantity_before INT UNSIGNED NOT NULL DEFAULT 0,
  quantity_delta INT NOT NULL DEFAULT 0,
  quantity_after INT UNSIGNED NOT NULL DEFAULT 0,
  estimated_unit_price DECIMAL(14,2) NULL,
  estimated_line_total DECIMAL(14,2) NULL,
  occurred_at DATETIME NOT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (visit_event_id),
  UNIQUE KEY uq_qr_visit_event_visitor_client_id (visitor_id, client_event_id),
  KEY idx_qr_visit_event_visitor_time (visitor_id, occurred_at),
  KEY idx_qr_visit_event_menu_time (menu_id, occurred_at),
  KEY idx_qr_visit_event_source_time (source, occurred_at),
  KEY idx_qr_visit_event_type_time (event_type, occurred_at),
  KEY idx_qr_visit_event_wait_order (wait_order_id),
  KEY idx_qr_visit_event_order (order_id),
  CONSTRAINT fk_qr_visit_event_visitor FOREIGN KEY (visitor_id) REFERENCES qr_visit_sessions(visitor_id) ON DELETE CASCADE,
  CONSTRAINT fk_qr_visit_event_wait_order FOREIGN KEY (wait_order_id) REFERENCES qr_wait_orders(wait_order_id) ON DELETE SET NULL,
  CONSTRAINT fk_qr_visit_event_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The app janitor expires pending wait orders and removes anonymous event data after 180 days.
