-- restaurant_pos.sql
-- Target: MariaDB 10.11.8
-- New restaurant POS / QR ordering / inventory / purchasing / coupon schema
-- Character set: utf8mb4
-- Design rule:
--   * Money: DECIMAL(14,2)
--   * Inventory quantities: integer minimum units (g, ml, EA, BOTTLE, CAN...)
--   * Historical sales/purchase records are not cascade-deleted.
--   * current_qty is a fast current balance; inventory_transactions is the audit ledger.

CREATE DATABASE IF NOT EXISTS TDK_POS
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE TDK_POS;

SET NAMES utf8mb4;

-- =========================================================
-- 1. BASIC MASTER TABLES
-- =========================================================

CREATE TABLE languages (
    language_code VARCHAR(10) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    native_name VARCHAR(50) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE staff (
    staff_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    staff_code VARCHAR(30) NOT NULL,
    name VARCHAR(100) NOT NULL,
    pin_hash VARCHAR(255) NULL,
    role ENUM('OWNER','MANAGER','STAFF') NOT NULL DEFAULT 'STAFF',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_staff_code (staff_code)
) ENGINE=InnoDB;

CREATE TABLE pos_devices (
    device_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    device_code VARCHAR(50) NOT NULL,
    device_name VARCHAR(100) NOT NULL,
    location VARCHAR(100) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_pos_device_code (device_code)
) ENGINE=InnoDB;

CREATE TABLE staff_sessions (
    staff_session_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    staff_id BIGINT UNSIGNED NOT NULL,
    device_id BIGINT UNSIGNED NULL,
    session_token_hash VARCHAR(255) NULL,
    logged_in_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_active_at DATETIME NULL,
    logged_out_at DATETIME NULL,
    status ENUM('ACTIVE','LOGGED_OUT','EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT fk_staff_sessions_staff
      FOREIGN KEY (staff_id) REFERENCES staff(staff_id),
    CONSTRAINT fk_staff_sessions_device
      FOREIGN KEY (device_id) REFERENCES pos_devices(device_id),
    KEY idx_staff_sessions_active (staff_id, status)
) ENGINE=InnoDB;

CREATE TABLE prep_stations (
    prep_station_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    station_code VARCHAR(30) NOT NULL,
    station_name VARCHAR(100) NOT NULL,
    station_type ENUM('KITCHEN','HALL','BEVERAGE','OTHER') NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_prep_station_code (station_code)
) ENGINE=InnoDB;

CREATE TABLE payment_methods (
    payment_method_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    method_code VARCHAR(30) NOT NULL,
    method_name VARCHAR(100) NOT NULL,
    method_type ENUM('CASH','CARD','VOUCHER','CREDIT','TRANSFER','OTHER') NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_payment_method_code (method_code)
) ENGINE=InnoDB;

CREATE TABLE promotion_channels (
    promotion_channel_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    channel_code VARCHAR(30) NOT NULL,
    channel_name VARCHAR(100) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY uq_promotion_channel_code (channel_code)
) ENGINE=InnoDB;

CREATE TABLE billing_accounts (
    billing_account_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    account_code VARCHAR(30) NULL,
    account_name VARCHAR(150) NOT NULL,
    account_type ENUM('COMPANY','GOVERNMENT','SCHOOL','HOSPITAL','OTHER') NOT NULL DEFAULT 'OTHER',
    contact_name VARCHAR(100) NULL,
    phone VARCHAR(30) NULL,
    note VARCHAR(500) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY uq_billing_account_code (account_code)
) ENGINE=InnoDB;

CREATE TABLE suppliers (
    supplier_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    supplier_code VARCHAR(30) NULL,
    supplier_name VARCHAR(150) NOT NULL,
    business_no VARCHAR(30) NULL,
    contact_name VARCHAR(100) NULL,
    phone VARCHAR(30) NULL,
    address VARCHAR(255) NULL,
    note VARCHAR(500) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_supplier_code (supplier_code)
) ENGINE=InnoDB;

-- =========================================================
-- 2. DINING TABLE / PARTY / SESSION
-- =========================================================

CREATE TABLE dining_tables (
    table_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    table_no VARCHAR(20) NOT NULL,
    table_name VARCHAR(100) NULL,
    capacity INT NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_dining_table_no (table_no)
) ENGINE=InnoDB;

CREATE TABLE party_groups (
    group_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    status ENUM('ACTIVE','RELEASED') NOT NULL DEFAULT 'ACTIVE',
    created_by_staff_id BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_at DATETIME NULL,
    CONSTRAINT fk_party_groups_staff
      FOREIGN KEY (created_by_staff_id) REFERENCES staff(staff_id),
    KEY idx_party_groups_status (status)
) ENGINE=InnoDB;

CREATE TABLE table_sessions (
    session_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    table_id BIGINT UNSIGNED NOT NULL,
    group_id BIGINT UNSIGNED NULL,
    person_count INT NOT NULL DEFAULT 0,
    baby_count INT NOT NULL DEFAULT 0,
    status ENUM('OPEN','CLOSED','CANCELLED') NOT NULL DEFAULT 'OPEN',
    opened_by_staff_id BIGINT UNSIGNED NULL,
    closed_by_staff_id BIGINT UNSIGNED NULL,
    opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME NULL,
    note VARCHAR(500) NULL,
    CONSTRAINT fk_table_sessions_table
      FOREIGN KEY (table_id) REFERENCES dining_tables(table_id),
    CONSTRAINT fk_table_sessions_group
      FOREIGN KEY (group_id) REFERENCES party_groups(group_id),
    CONSTRAINT fk_table_sessions_open_staff
      FOREIGN KEY (opened_by_staff_id) REFERENCES staff(staff_id),
    CONSTRAINT fk_table_sessions_close_staff
      FOREIGN KEY (closed_by_staff_id) REFERENCES staff(staff_id),
    KEY idx_table_sessions_table_status (table_id, status),
    KEY idx_table_sessions_group_status (group_id, status)
) ENGINE=InnoDB;

-- =========================================================
-- 3. INVENTORY MASTER
-- =========================================================

CREATE TABLE inventory_items (
    inventory_item_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    item_code VARCHAR(40) NULL,
    item_name VARCHAR(150) NOT NULL,
    item_type ENUM('INGREDIENT','PREPARED','BEVERAGE','LIQUOR','SUPPLY','OTHER') NOT NULL DEFAULT 'OTHER',
    base_unit VARCHAR(20) NOT NULL COMMENT 'g, ml, EA, BOTTLE, CAN etc.',
    tracking_type ENUM('REALTIME','THEORETICAL','NONE') NOT NULL DEFAULT 'REALTIME',
    current_qty BIGINT NOT NULL DEFAULT 0,
    low_stock_qty BIGINT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_inventory_item_code (item_code),
    KEY idx_inventory_item_name (item_name)
) ENGINE=InnoDB;

CREATE TABLE inventory_units (
    inventory_unit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    inventory_item_id BIGINT UNSIGNED NOT NULL,
    unit_name VARCHAR(50) NOT NULL,
    conversion_qty BIGINT NOT NULL COMMENT 'How many base units per purchase unit',
    is_default_purchase_unit TINYINT(1) NOT NULL DEFAULT 0,
    CONSTRAINT fk_inventory_units_item
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(inventory_item_id),
    UNIQUE KEY uq_inventory_unit (inventory_item_id, unit_name),
    CHECK (conversion_qty > 0)
) ENGINE=InnoDB;

-- =========================================================
-- 4. MENU / CATEGORY / TRANSLATION / IMAGES
-- =========================================================

CREATE TABLE menu_categories (
    category_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    pos_name VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE category_translations (
    category_id BIGINT UNSIGNED NOT NULL,
    language_code VARCHAR(10) NOT NULL,
    name VARCHAR(150) NOT NULL,
    PRIMARY KEY (category_id, language_code),
    CONSTRAINT fk_category_translations_category
      FOREIGN KEY (category_id) REFERENCES menu_categories(category_id) ON DELETE CASCADE,
    CONSTRAINT fk_category_translations_language
      FOREIGN KEY (language_code) REFERENCES languages(language_code)
) ENGINE=InnoDB;

CREATE TABLE menus (
    menu_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    menu_code VARCHAR(40) NOT NULL,
    pos_name VARCHAR(150) NOT NULL,
    category_id BIGINT UNSIGNED NULL,
    price DECIMAL(14,2) NOT NULL DEFAULT 0,
    prep_station_id BIGINT UNSIGNED NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_qr_visible TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_menu_code (menu_code),
    CONSTRAINT fk_menus_category
      FOREIGN KEY (category_id) REFERENCES menu_categories(category_id),
    CONSTRAINT fk_menus_station
      FOREIGN KEY (prep_station_id) REFERENCES prep_stations(prep_station_id),
    KEY idx_menus_category_active (category_id, is_active)
) ENGINE=InnoDB;

CREATE TABLE menu_translations (
    menu_id BIGINT UNSIGNED NOT NULL,
    language_code VARCHAR(10) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT NULL,
    PRIMARY KEY (menu_id, language_code),
    CONSTRAINT fk_menu_translations_menu
      FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE,
    CONSTRAINT fk_menu_translations_language
      FOREIGN KEY (language_code) REFERENCES languages(language_code)
) ENGINE=InnoDB;

CREATE TABLE menu_images (
    menu_image_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    menu_id BIGINT UNSIGNED NOT NULL,
    image_type ENUM('POS','QR_THUMBNAIL','QR_LARGE','OTHER') NOT NULL,
    image_url VARCHAR(500) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_menu_images_menu
      FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE,
    KEY idx_menu_images_menu_type (menu_id, image_type, is_active)
) ENGINE=InnoDB;

-- Menu -> inventory consumption mapping.
-- Useful for standalone cola/soju/rice sales.
CREATE TABLE menu_inventory (
    menu_id BIGINT UNSIGNED NOT NULL,
    inventory_item_id BIGINT UNSIGNED NOT NULL,
    qty_used BIGINT NOT NULL DEFAULT 1,
    PRIMARY KEY (menu_id, inventory_item_id),
    CONSTRAINT fk_menu_inventory_menu
      FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE,
    CONSTRAINT fk_menu_inventory_item
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(inventory_item_id),
    CHECK (qty_used > 0)
) ENGINE=InnoDB;

-- Included components: e.g. Kimchi stew -> rice x 1.
CREATE TABLE menu_components (
    menu_component_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    parent_menu_id BIGINT UNSIGNED NOT NULL,
    component_menu_id BIGINT UNSIGNED NOT NULL,
    qty_per_unit INT NOT NULL DEFAULT 1,
    print_on_kitchen TINYINT(1) NOT NULL DEFAULT 1,
    print_on_receipt TINYINT(1) NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    CONSTRAINT fk_menu_components_parent
      FOREIGN KEY (parent_menu_id) REFERENCES menus(menu_id),
    CONSTRAINT fk_menu_components_component
      FOREIGN KEY (component_menu_id) REFERENCES menus(menu_id),
    UNIQUE KEY uq_menu_component (parent_menu_id, component_menu_id),
    CHECK (qty_per_unit > 0),
    CHECK (parent_menu_id <> component_menu_id)
) ENGINE=InnoDB;

-- Recipe/theoretical ingredient consumption.
CREATE TABLE menu_recipes (
    menu_id BIGINT UNSIGNED NOT NULL,
    inventory_item_id BIGINT UNSIGNED NOT NULL,
    qty_per_unit BIGINT NOT NULL,
    PRIMARY KEY (menu_id, inventory_item_id),
    CONSTRAINT fk_menu_recipes_menu
      FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE,
    CONSTRAINT fk_menu_recipes_inventory
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(inventory_item_id),
    CHECK (qty_per_unit > 0)
) ENGINE=InnoDB;

-- =========================================================
-- 5. MENU MODIFIERS / OPTIONS
-- =========================================================

CREATE TABLE modifier_groups (
    modifier_group_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    pos_name VARCHAR(150) NOT NULL,
    min_select INT NOT NULL DEFAULT 0,
    max_select INT NOT NULL DEFAULT 1,
    is_required TINYINT(1) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    CHECK (min_select >= 0),
    CHECK (max_select >= min_select)
) ENGINE=InnoDB;

CREATE TABLE modifier_group_translations (
    modifier_group_id BIGINT UNSIGNED NOT NULL,
    language_code VARCHAR(10) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description VARCHAR(500) NULL,
    PRIMARY KEY (modifier_group_id, language_code),
    CONSTRAINT fk_modifier_group_trans_group
      FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(modifier_group_id) ON DELETE CASCADE,
    CONSTRAINT fk_modifier_group_trans_language
      FOREIGN KEY (language_code) REFERENCES languages(language_code)
) ENGINE=InnoDB;

CREATE TABLE modifier_options (
    modifier_option_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    modifier_group_id BIGINT UNSIGNED NOT NULL,
    pos_name VARCHAR(150) NOT NULL,
    price_delta DECIMAL(14,2) NOT NULL DEFAULT 0,
    linked_menu_id BIGINT UNSIGNED NULL COMMENT 'Optional: option represents another menu item',
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    CONSTRAINT fk_modifier_options_group
      FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(modifier_group_id) ON DELETE CASCADE,
    CONSTRAINT fk_modifier_options_linked_menu
      FOREIGN KEY (linked_menu_id) REFERENCES menus(menu_id),
    KEY idx_modifier_options_group (modifier_group_id, is_active)
) ENGINE=InnoDB;

CREATE TABLE modifier_option_translations (
    modifier_option_id BIGINT UNSIGNED NOT NULL,
    language_code VARCHAR(10) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description VARCHAR(500) NULL,
    PRIMARY KEY (modifier_option_id, language_code),
    CONSTRAINT fk_modifier_option_trans_option
      FOREIGN KEY (modifier_option_id) REFERENCES modifier_options(modifier_option_id) ON DELETE CASCADE,
    CONSTRAINT fk_modifier_option_trans_language
      FOREIGN KEY (language_code) REFERENCES languages(language_code)
) ENGINE=InnoDB;

CREATE TABLE menu_modifier_groups (
    menu_id BIGINT UNSIGNED NOT NULL,
    modifier_group_id BIGINT UNSIGNED NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    PRIMARY KEY (menu_id, modifier_group_id),
    CONSTRAINT fk_menu_modifier_groups_menu
      FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE,
    CONSTRAINT fk_menu_modifier_groups_group
      FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(modifier_group_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =========================================================
-- 6. ORDERS / ORDER ITEMS
-- =========================================================

CREATE TABLE orders (
    order_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT UNSIGNED NOT NULL,
    order_type ENUM('POS','QR','OTHER') NOT NULL DEFAULT 'POS',
    status ENUM('OPEN','ACCEPTED','CANCELLED','COMPLETED') NOT NULL DEFAULT 'ACCEPTED',
    subtotal_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    created_by_staff_id BIGINT UNSIGNED NULL,
    accepted_by_staff_id BIGINT UNSIGNED NULL,
    ordered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accepted_at DATETIME NULL,
    note VARCHAR(500) NULL,
    CONSTRAINT fk_orders_session
      FOREIGN KEY (session_id) REFERENCES table_sessions(session_id),
    CONSTRAINT fk_orders_created_staff
      FOREIGN KEY (created_by_staff_id) REFERENCES staff(staff_id),
    CONSTRAINT fk_orders_accepted_staff
      FOREIGN KEY (accepted_by_staff_id) REFERENCES staff(staff_id),
    KEY idx_orders_session_status (session_id, status),
    KEY idx_orders_ordered_at (ordered_at)
) ENGINE=InnoDB;

CREATE TABLE order_items (
    order_item_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL,
    parent_order_item_id BIGINT UNSIGNED NULL COMMENT 'Included component parent',
    menu_id BIGINT UNSIGNED NOT NULL,
    item_name VARCHAR(200) NOT NULL COMMENT 'Snapshot at order time',
    qty INT NOT NULL,
    unit_price DECIMAL(14,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    prep_station_id BIGINT UNSIGNED NULL COMMENT 'Snapshot routing',
    item_type ENUM('NORMAL','COMPONENT','SERVICE') NOT NULL DEFAULT 'NORMAL',
    status ENUM('ORDERED','PREPARING','READY','SERVED','CANCELLED') NOT NULL DEFAULT 'ORDERED',
    print_on_receipt TINYINT(1) NOT NULL DEFAULT 1,
    ordered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cancelled_at DATETIME NULL,
    cancelled_by_staff_id BIGINT UNSIGNED NULL,
    note VARCHAR(500) NULL,
    CONSTRAINT fk_order_items_order
      FOREIGN KEY (order_id) REFERENCES orders(order_id),
    CONSTRAINT fk_order_items_parent
      FOREIGN KEY (parent_order_item_id) REFERENCES order_items(order_item_id),
    CONSTRAINT fk_order_items_menu
      FOREIGN KEY (menu_id) REFERENCES menus(menu_id),
    CONSTRAINT fk_order_items_station
      FOREIGN KEY (prep_station_id) REFERENCES prep_stations(prep_station_id),
    CONSTRAINT fk_order_items_cancel_staff
      FOREIGN KEY (cancelled_by_staff_id) REFERENCES staff(staff_id),
    KEY idx_order_items_order (order_id, status),
    KEY idx_order_items_station_status (prep_station_id, status),
    CHECK (qty > 0)
) ENGINE=InnoDB;

CREATE TABLE order_item_options (
    order_item_option_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_item_id BIGINT UNSIGNED NOT NULL,
    modifier_option_id BIGINT UNSIGNED NULL,
    option_name VARCHAR(200) NOT NULL COMMENT 'Snapshot',
    qty INT NOT NULL DEFAULT 1,
    unit_price DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    CONSTRAINT fk_order_item_options_item
      FOREIGN KEY (order_item_id) REFERENCES order_items(order_item_id),
    CONSTRAINT fk_order_item_options_option
      FOREIGN KEY (modifier_option_id) REFERENCES modifier_options(modifier_option_id),
    CHECK (qty > 0)
) ENGINE=InnoDB;

-- =========================================================
-- 7. QR SESSION / CART / QR ORDER STAGING
-- =========================================================

CREATE TABLE qr_sessions (
    qr_session_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT UNSIGNED NULL,
    token_hash VARCHAR(255) NOT NULL,
    language_code VARCHAR(10) NOT NULL DEFAULT 'ko',
    status ENUM('ACTIVE','CLOSED','EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_active_at DATETIME NULL,
    closed_at DATETIME NULL,
    UNIQUE KEY uq_qr_session_token (token_hash),
    CONSTRAINT fk_qr_sessions_table_session
      FOREIGN KEY (session_id) REFERENCES table_sessions(session_id),
    CONSTRAINT fk_qr_sessions_language
      FOREIGN KEY (language_code) REFERENCES languages(language_code),
    KEY idx_qr_sessions_session_status (session_id, status)
) ENGINE=InnoDB;

CREATE TABLE qr_cart_items (
    cart_item_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    qr_session_id BIGINT UNSIGNED NOT NULL,
    menu_id BIGINT UNSIGNED NOT NULL,
    qty INT NOT NULL DEFAULT 1,
    unit_price DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_qr_cart_items_session
      FOREIGN KEY (qr_session_id) REFERENCES qr_sessions(qr_session_id) ON DELETE CASCADE,
    CONSTRAINT fk_qr_cart_items_menu
      FOREIGN KEY (menu_id) REFERENCES menus(menu_id),
    CHECK (qty > 0)
) ENGINE=InnoDB;

CREATE TABLE qr_cart_item_options (
    cart_item_option_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cart_item_id BIGINT UNSIGNED NOT NULL,
    modifier_option_id BIGINT UNSIGNED NOT NULL,
    qty INT NOT NULL DEFAULT 1,
    unit_price DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    CONSTRAINT fk_qr_cart_options_cart_item
      FOREIGN KEY (cart_item_id) REFERENCES qr_cart_items(cart_item_id) ON DELETE CASCADE,
    CONSTRAINT fk_qr_cart_options_modifier
      FOREIGN KEY (modifier_option_id) REFERENCES modifier_options(modifier_option_id),
    CHECK (qty > 0)
) ENGINE=InnoDB;

CREATE TABLE qr_orders (
    qr_order_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    qr_session_id BIGINT UNSIGNED NOT NULL,
    status ENUM('PENDING','ACCEPTED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
    subtotal_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    accepted_order_id BIGINT UNSIGNED NULL,
    ordered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accepted_at DATETIME NULL,
    accepted_by_staff_id BIGINT UNSIGNED NULL,
    rejected_at DATETIME NULL,
    note VARCHAR(500) NULL,
    CONSTRAINT fk_qr_orders_session
      FOREIGN KEY (qr_session_id) REFERENCES qr_sessions(qr_session_id),
    CONSTRAINT fk_qr_orders_accepted_order
      FOREIGN KEY (accepted_order_id) REFERENCES orders(order_id),
    CONSTRAINT fk_qr_orders_staff
      FOREIGN KEY (accepted_by_staff_id) REFERENCES staff(staff_id),
    UNIQUE KEY uq_qr_orders_accepted_order (accepted_order_id),
    KEY idx_qr_orders_status_time (status, ordered_at)
) ENGINE=InnoDB;

CREATE TABLE qr_order_items (
    qr_order_item_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    qr_order_id BIGINT UNSIGNED NOT NULL,
    menu_id BIGINT UNSIGNED NOT NULL,
    item_name VARCHAR(200) NOT NULL COMMENT 'Snapshot',
    qty INT NOT NULL,
    unit_price DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    note VARCHAR(500) NULL,
    CONSTRAINT fk_qr_order_items_order
      FOREIGN KEY (qr_order_id) REFERENCES qr_orders(qr_order_id),
    CONSTRAINT fk_qr_order_items_menu
      FOREIGN KEY (menu_id) REFERENCES menus(menu_id),
    KEY idx_qr_order_items_order (qr_order_id),
    CHECK (qty > 0)
) ENGINE=InnoDB;

CREATE TABLE qr_order_item_options (
    qr_order_item_option_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    qr_order_item_id BIGINT UNSIGNED NOT NULL,
    modifier_option_id BIGINT UNSIGNED NULL,
    option_name VARCHAR(200) NOT NULL COMMENT 'Snapshot',
    qty INT NOT NULL DEFAULT 1,
    unit_price DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    CONSTRAINT fk_qr_order_item_options_item
      FOREIGN KEY (qr_order_item_id) REFERENCES qr_order_items(qr_order_item_id),
    CONSTRAINT fk_qr_order_item_options_modifier
      FOREIGN KEY (modifier_option_id) REFERENCES modifier_options(modifier_option_id),
    CHECK (qty > 0)
) ENGINE=InnoDB;

-- =========================================================
-- 8. CHECKOUT / PARTIAL SETTLEMENT / PAYMENTS
-- =========================================================

CREATE TABLE checkouts (
    checkout_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    subtotal_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    paid_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    status ENUM('OPEN','PARTIALLY_PAID','PAID','CANCELLED','REFUNDED') NOT NULL DEFAULT 'OPEN',
    created_by_staff_id BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    note VARCHAR(500) NULL,
    CONSTRAINT fk_checkouts_staff
      FOREIGN KEY (created_by_staff_id) REFERENCES staff(staff_id),
    KEY idx_checkouts_status_time (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE checkout_items (
    checkout_item_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    checkout_id BIGINT UNSIGNED NOT NULL,
    order_item_id BIGINT UNSIGNED NOT NULL,
    qty INT NOT NULL,
    unit_price DECIMAL(14,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    CONSTRAINT fk_checkout_items_checkout
      FOREIGN KEY (checkout_id) REFERENCES checkouts(checkout_id),
    CONSTRAINT fk_checkout_items_order_item
      FOREIGN KEY (order_item_id) REFERENCES order_items(order_item_id),
    KEY idx_checkout_items_order_item (order_item_id),
    CHECK (qty > 0)
) ENGINE=InnoDB;

CREATE TABLE payments (
    payment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    checkout_id BIGINT UNSIGNED NOT NULL,
    payment_method_id BIGINT UNSIGNED NOT NULL,
    billing_account_id BIGINT UNSIGNED NULL,
    amount DECIMAL(14,2) NOT NULL,
    status ENUM('PENDING','APPROVED','CANCELLED','REFUNDED','FAILED') NOT NULL DEFAULT 'APPROVED',
    approval_no VARCHAR(100) NULL,
    external_transaction_id VARCHAR(150) NULL,
    original_payment_id BIGINT UNSIGNED NULL COMMENT 'For cancellation/refund relation',
    processed_by_staff_id BIGINT UNSIGNED NULL,
    paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cancelled_at DATETIME NULL,
    note VARCHAR(500) NULL,
    CONSTRAINT fk_payments_checkout
      FOREIGN KEY (checkout_id) REFERENCES checkouts(checkout_id),
    CONSTRAINT fk_payments_method
      FOREIGN KEY (payment_method_id) REFERENCES payment_methods(payment_method_id),
    CONSTRAINT fk_payments_billing_account
      FOREIGN KEY (billing_account_id) REFERENCES billing_accounts(billing_account_id),
    CONSTRAINT fk_payments_original
      FOREIGN KEY (original_payment_id) REFERENCES payments(payment_id),
    CONSTRAINT fk_payments_staff
      FOREIGN KEY (processed_by_staff_id) REFERENCES staff(staff_id),
    KEY idx_payments_checkout_status (checkout_id, status),
    KEY idx_payments_paid_at (paid_at)
) ENGINE=InnoDB;

-- =========================================================
-- 9. DISCOUNT / COUPONS
-- =========================================================

CREATE TABLE discount_rules (
    discount_rule_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    discount_code VARCHAR(40) NOT NULL,
    discount_name VARCHAR(150) NOT NULL,
    discount_type ENUM('RATE','AMOUNT','FREE_ITEM') NOT NULL,
    discount_value DECIMAL(14,2) NOT NULL DEFAULT 0,
    max_discount_amount DECIMAL(14,2) NULL,
    min_order_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    requires_manager TINYINT(1) NOT NULL DEFAULT 0,
    start_at DATETIME NULL,
    end_at DATETIME NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY uq_discount_rule_code (discount_code)
) ENGINE=InnoDB;

CREATE TABLE coupons (
    coupon_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    discount_rule_id BIGINT UNSIGNED NOT NULL,
    promotion_channel_id BIGINT UNSIGNED NOT NULL,
    coupon_name VARCHAR(150) NOT NULL,
    issue_type ENUM('SINGLE_CODE','MULTI_CODE','EXTERNAL') NOT NULL DEFAULT 'MULTI_CODE',
    common_code VARCHAR(100) NULL,
    max_issue_count INT NULL,
    max_use_count INT NULL,
    start_at DATETIME NULL,
    end_at DATETIME NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_coupons_discount_rule
      FOREIGN KEY (discount_rule_id) REFERENCES discount_rules(discount_rule_id),
    CONSTRAINT fk_coupons_channel
      FOREIGN KEY (promotion_channel_id) REFERENCES promotion_channels(promotion_channel_id)
) ENGINE=InnoDB;

CREATE TABLE coupon_codes (
    coupon_code_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    coupon_id BIGINT UNSIGNED NOT NULL,
    code VARCHAR(120) NOT NULL,
    status ENUM('ISSUED','USED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'ISSUED',
    issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NULL,
    customer_ref VARCHAR(150) NULL,
    CONSTRAINT fk_coupon_codes_coupon
      FOREIGN KEY (coupon_id) REFERENCES coupons(coupon_id),
    UNIQUE KEY uq_coupon_code (code),
    KEY idx_coupon_codes_coupon_status (coupon_id, status)
) ENGINE=InnoDB;

CREATE TABLE coupon_redemptions (
    redemption_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    coupon_id BIGINT UNSIGNED NOT NULL,
    coupon_code_id BIGINT UNSIGNED NULL,
    checkout_id BIGINT UNSIGNED NOT NULL,
    external_coupon_ref VARCHAR(150) NULL,
    external_redemption_ref VARCHAR(150) NULL,
    discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    status ENUM('USED','CANCELLED') NOT NULL DEFAULT 'USED',
    redeemed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_by_staff_id BIGINT UNSIGNED NULL,
    CONSTRAINT fk_coupon_redemptions_coupon
      FOREIGN KEY (coupon_id) REFERENCES coupons(coupon_id),
    CONSTRAINT fk_coupon_redemptions_code
      FOREIGN KEY (coupon_code_id) REFERENCES coupon_codes(coupon_code_id),
    CONSTRAINT fk_coupon_redemptions_checkout
      FOREIGN KEY (checkout_id) REFERENCES checkouts(checkout_id),
    CONSTRAINT fk_coupon_redemptions_staff
      FOREIGN KEY (processed_by_staff_id) REFERENCES staff(staff_id),
    KEY idx_coupon_redemptions_coupon_time (coupon_id, redeemed_at)
) ENGINE=InnoDB;

CREATE TABLE checkout_discounts (
    checkout_discount_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    checkout_id BIGINT UNSIGNED NOT NULL,
    discount_rule_id BIGINT UNSIGNED NOT NULL,
    redemption_id BIGINT UNSIGNED NULL,
    discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    reason VARCHAR(500) NULL,
    applied_by_staff_id BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_checkout_discounts_checkout
      FOREIGN KEY (checkout_id) REFERENCES checkouts(checkout_id),
    CONSTRAINT fk_checkout_discounts_rule
      FOREIGN KEY (discount_rule_id) REFERENCES discount_rules(discount_rule_id),
    CONSTRAINT fk_checkout_discounts_redemption
      FOREIGN KEY (redemption_id) REFERENCES coupon_redemptions(redemption_id),
    CONSTRAINT fk_checkout_discounts_staff
      FOREIGN KEY (applied_by_staff_id) REFERENCES staff(staff_id),
    KEY idx_checkout_discounts_checkout (checkout_id)
) ENGINE=InnoDB;

-- =========================================================
-- 10. PURCHASES / ACCOUNTS PAYABLE
-- =========================================================

CREATE TABLE purchases (
    purchase_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    supplier_id BIGINT UNSIGNED NOT NULL,
    purchase_no VARCHAR(50) NULL,
    purchase_type ENUM('DIRECT','CREDIT') NOT NULL DEFAULT 'DIRECT',
    supply_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    payment_status ENUM('UNPAID','PARTIAL','PAID','CANCELLED') NOT NULL DEFAULT 'UNPAID',
    purchased_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    due_date DATE NULL,
    created_by_staff_id BIGINT UNSIGNED NULL,
    note VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_purchases_supplier
      FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id),
    CONSTRAINT fk_purchases_staff
      FOREIGN KEY (created_by_staff_id) REFERENCES staff(staff_id),
    KEY idx_purchases_supplier_date (supplier_id, purchased_at),
    KEY idx_purchases_payment_status (payment_status)
) ENGINE=InnoDB;

CREATE TABLE purchase_items (
    purchase_item_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    purchase_id BIGINT UNSIGNED NOT NULL,
    inventory_item_id BIGINT UNSIGNED NOT NULL,
    inventory_unit_id BIGINT UNSIGNED NULL,
    item_name VARCHAR(200) NOT NULL COMMENT 'Purchase-time snapshot',
    purchase_qty BIGINT NOT NULL COMMENT 'Number of selected purchase units',
    unit_conversion_qty BIGINT NOT NULL DEFAULT 1 COMMENT 'Base units per selected unit snapshot',
    inventory_qty BIGINT NOT NULL COMMENT 'Total base-unit quantity received',
    unit_cost DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'Cost per selected purchase unit',
    supply_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    CONSTRAINT fk_purchase_items_purchase
      FOREIGN KEY (purchase_id) REFERENCES purchases(purchase_id),
    CONSTRAINT fk_purchase_items_inventory
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(inventory_item_id),
    CONSTRAINT fk_purchase_items_unit
      FOREIGN KEY (inventory_unit_id) REFERENCES inventory_units(inventory_unit_id),
    KEY idx_purchase_items_inventory (inventory_item_id),
    CHECK (purchase_qty > 0),
    CHECK (inventory_qty > 0)
) ENGINE=InnoDB;

CREATE TABLE purchase_payments (
    purchase_payment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    supplier_id BIGINT UNSIGNED NOT NULL,
    payment_method_id BIGINT UNSIGNED NOT NULL,
    amount DECIMAL(14,2) NOT NULL,
    paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_by_staff_id BIGINT UNSIGNED NULL,
    reference_no VARCHAR(100) NULL,
    note VARCHAR(500) NULL,
    CONSTRAINT fk_purchase_payments_supplier
      FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id),
    CONSTRAINT fk_purchase_payments_method
      FOREIGN KEY (payment_method_id) REFERENCES payment_methods(payment_method_id),
    CONSTRAINT fk_purchase_payments_staff
      FOREIGN KEY (processed_by_staff_id) REFERENCES staff(staff_id),
    KEY idx_purchase_payments_supplier_date (supplier_id, paid_at),
    CHECK (amount > 0)
) ENGINE=InnoDB;

CREATE TABLE purchase_payment_allocations (
    purchase_payment_allocation_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    purchase_payment_id BIGINT UNSIGNED NOT NULL,
    purchase_id BIGINT UNSIGNED NOT NULL,
    amount DECIMAL(14,2) NOT NULL,
    CONSTRAINT fk_purchase_alloc_payment
      FOREIGN KEY (purchase_payment_id) REFERENCES purchase_payments(purchase_payment_id),
    CONSTRAINT fk_purchase_alloc_purchase
      FOREIGN KEY (purchase_id) REFERENCES purchases(purchase_id),
    UNIQUE KEY uq_purchase_payment_allocation (purchase_payment_id, purchase_id),
    CHECK (amount > 0)
) ENGINE=InnoDB;

-- =========================================================
-- 11. INVENTORY LEDGER
-- =========================================================

CREATE TABLE inventory_transactions (
    inventory_transaction_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    inventory_item_id BIGINT UNSIGNED NOT NULL,
    transaction_type ENUM(
        'OPENING',
        'PURCHASE',
        'SALE',
        'PRODUCTION',
        'WASTE',
        'SERVICE',
        'ADJUSTMENT',
        'RETURN_IN',
        'RETURN_OUT',
        'OTHER'
    ) NOT NULL,
    qty_change BIGINT NOT NULL COMMENT 'Positive=in, negative=out',
    balance_after BIGINT NULL COMMENT 'Snapshot after applying transaction',
    order_item_id BIGINT UNSIGNED NULL,
    purchase_item_id BIGINT UNSIGNED NULL,
    staff_id BIGINT UNSIGNED NULL,
    transaction_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    remark VARCHAR(500) NULL,
    CONSTRAINT fk_inventory_transactions_item
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(inventory_item_id),
    CONSTRAINT fk_inventory_transactions_order_item
      FOREIGN KEY (order_item_id) REFERENCES order_items(order_item_id),
    CONSTRAINT fk_inventory_transactions_purchase_item
      FOREIGN KEY (purchase_item_id) REFERENCES purchase_items(purchase_item_id),
    CONSTRAINT fk_inventory_transactions_staff
      FOREIGN KEY (staff_id) REFERENCES staff(staff_id),
    KEY idx_inventory_tx_item_time (inventory_item_id, transaction_at),
    KEY idx_inventory_tx_type_time (transaction_type, transaction_at),
    CHECK (qty_change <> 0)
) ENGINE=InnoDB;

-- Physical stock counts.
CREATE TABLE inventory_counts (
    inventory_count_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    counted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status ENUM('OPEN','CONFIRMED','CANCELLED') NOT NULL DEFAULT 'OPEN',
    counted_by_staff_id BIGINT UNSIGNED NULL,
    confirmed_by_staff_id BIGINT UNSIGNED NULL,
    note VARCHAR(500) NULL,
    CONSTRAINT fk_inventory_counts_count_staff
      FOREIGN KEY (counted_by_staff_id) REFERENCES staff(staff_id),
    CONSTRAINT fk_inventory_counts_confirm_staff
      FOREIGN KEY (confirmed_by_staff_id) REFERENCES staff(staff_id)
) ENGINE=InnoDB;

CREATE TABLE inventory_count_items (
    inventory_count_item_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    inventory_count_id BIGINT UNSIGNED NOT NULL,
    inventory_item_id BIGINT UNSIGNED NOT NULL,
    system_qty BIGINT NOT NULL,
    counted_qty BIGINT NOT NULL,
    difference_qty BIGINT NOT NULL,
    CONSTRAINT fk_inventory_count_items_count
      FOREIGN KEY (inventory_count_id) REFERENCES inventory_counts(inventory_count_id),
    CONSTRAINT fk_inventory_count_items_inventory
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(inventory_item_id),
    UNIQUE KEY uq_inventory_count_item (inventory_count_id, inventory_item_id)
) ENGINE=InnoDB;

-- =========================================================
-- 12. AUDIT LOG
-- =========================================================

CREATE TABLE audit_logs (
    audit_log_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    staff_id BIGINT UNSIGNED NULL,
    device_id BIGINT UNSIGNED NULL,
    action_type VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id BIGINT UNSIGNED NULL,
    description VARCHAR(1000) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_logs_staff
      FOREIGN KEY (staff_id) REFERENCES staff(staff_id),
    CONSTRAINT fk_audit_logs_device
      FOREIGN KEY (device_id) REFERENCES pos_devices(device_id),
    KEY idx_audit_entity (entity_type, entity_id),
    KEY idx_audit_time (created_at)
) ENGINE=InnoDB;

-- =========================================================
-- 13. INITIAL MASTER DATA
-- =========================================================

INSERT INTO languages (language_code, name, native_name, is_active, sort_order) VALUES
('ko',    'Korean',              '한국어',   1, 1),
('en',    'English',             'English',  1, 2),
('ja',    'Japanese',            '日本語',   1, 3),
('zh-CN', 'Simplified Chinese',  '简体中文', 1, 4);

INSERT INTO prep_stations (station_code, station_name, station_type, sort_order) VALUES
('KITCHEN',  '주방', 'KITCHEN',  1),
('HALL',     '홀',   'HALL',     2),
('BEVERAGE', '음료', 'BEVERAGE', 3);

INSERT INTO payment_methods (method_code, method_name, method_type, sort_order) VALUES
('CASH',        '현금',       'CASH',     1),
('CARD',        '카드',       'CARD',     2),
('GIFT',        '상품권',     'VOUCHER',  3),
('MEAL_TICKET', '후불식권',   'CREDIT',   4),
('TRANSFER',    '계좌이체',   'TRANSFER', 5),
('OTHER',       '기타',       'OTHER',    99);

INSERT INTO promotion_channels (channel_code, channel_name) VALUES
('INTERNAL', '자체발행'),
('NAVER',    '네이버'),
('KAKAO',    '카카오'),
('PAPER',    '종이쿠폰'),
('ETC',      '기타');

-- =========================================================
-- 14. USEFUL VIEWS
-- =========================================================

-- Current open table sessions.
CREATE OR REPLACE VIEW v_open_table_sessions AS
SELECT
    ts.session_id,
    ts.table_id,
    dt.table_no,
    dt.table_name,
    ts.group_id,
    ts.person_count,
    ts.baby_count,
    ts.opened_at
FROM table_sessions ts
JOIN dining_tables dt ON dt.table_id = ts.table_id
WHERE ts.status = 'OPEN';

-- Session order totals excluding cancelled orders.
CREATE OR REPLACE VIEW v_session_order_totals AS
SELECT
    o.session_id,
    COUNT(*) AS order_count,
    COALESCE(SUM(o.subtotal_amount), 0) AS subtotal_amount,
    COALESCE(SUM(o.discount_amount), 0) AS discount_amount,
    COALESCE(SUM(o.total_amount), 0) AS total_amount
FROM orders o
WHERE o.status <> 'CANCELLED'
GROUP BY o.session_id;

-- Current inventory.
CREATE OR REPLACE VIEW v_inventory_status AS
SELECT
    inventory_item_id,
    item_code,
    item_name,
    item_type,
    base_unit,
    tracking_type,
    current_qty,
    low_stock_qty,
    CASE
        WHEN low_stock_qty IS NOT NULL AND current_qty <= low_stock_qty THEN 1
        ELSE 0
    END AS is_low_stock
FROM inventory_items
WHERE is_active = 1;

-- Supplier outstanding purchase balance.
CREATE OR REPLACE VIEW v_supplier_payables AS
SELECT
    p.supplier_id,
    s.supplier_name,
    SUM(p.total_amount) AS purchase_amount,
    SUM(COALESCE(pa.paid_amount, 0)) AS allocated_payment_amount,
    SUM(p.total_amount - COALESCE(pa.paid_amount, 0)) AS outstanding_amount
FROM purchases p
JOIN suppliers s ON s.supplier_id = p.supplier_id
LEFT JOIN (
    SELECT purchase_id, SUM(amount) AS paid_amount
    FROM purchase_payment_allocations
    GROUP BY purchase_id
) pa ON pa.purchase_id = p.purchase_id
WHERE p.payment_status <> 'CANCELLED'
GROUP BY p.supplier_id, s.supplier_name;

-- Daily menu sales (paid status is not required here; this is accepted order sales).
CREATE OR REPLACE VIEW v_daily_menu_sales AS
SELECT
    DATE(o.ordered_at) AS sale_date,
    oi.menu_id,
    oi.item_name,
    SUM(oi.qty) AS qty,
    SUM(oi.total_amount) AS amount
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
WHERE o.status <> 'CANCELLED'
  AND oi.status <> 'CANCELLED'
  AND oi.item_type <> 'COMPONENT'
GROUP BY DATE(o.ordered_at), oi.menu_id, oi.item_name;

-- Theoretical ingredient usage from menu recipe and sales.
CREATE OR REPLACE VIEW v_daily_theoretical_ingredient_usage AS
SELECT
    DATE(o.ordered_at) AS usage_date,
    mr.inventory_item_id,
    ii.item_name AS inventory_item_name,
    ii.base_unit,
    SUM(oi.qty * mr.qty_per_unit) AS theoretical_qty
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
JOIN menu_recipes mr ON mr.menu_id = oi.menu_id
JOIN inventory_items ii ON ii.inventory_item_id = mr.inventory_item_id
WHERE o.status <> 'CANCELLED'
  AND oi.status <> 'CANCELLED'
  AND oi.item_type <> 'COMPONENT'
GROUP BY DATE(o.ordered_at), mr.inventory_item_id, ii.item_name, ii.base_unit;

-- =========================================================
-- IMPORTANT APPLICATION TRANSACTION RULES
-- =========================================================
-- 1) Do not trust staff_id sent by the browser. Resolve staff identity from
--    the authenticated server-side session/token.
--
-- 2) Purchase receipt:
--      START TRANSACTION
--      INSERT purchases / purchase_items
--      INSERT inventory_transactions (+inventory_qty)
--      UPDATE inventory_items.current_qty
--      COMMIT
--
-- 3) Realtime inventory sale:
--      START TRANSACTION
--      INSERT order / order_items
--      INSERT inventory_transactions (-qty)
--      UPDATE inventory_items.current_qty
--      COMMIT
--
-- 4) QR acceptance:
--      START TRANSACTION
--      lock qr_orders row
--      verify status=PENDING
--      INSERT orders/order_items/options
--      UPDATE qr_orders SET status='ACCEPTED', accepted_order_id=...
--      COMMIT
--
-- 5) Checkout:
--    Before inserting checkout_items, verify that completed/non-cancelled
--    allocations for an order_item do not exceed order_items.qty.
--
-- 6) Do not physically delete historical orders, payments, purchases,
--    inventory transactions, coupon redemptions, or audit records.
