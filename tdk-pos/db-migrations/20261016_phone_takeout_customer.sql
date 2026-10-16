-- Apply to the target POS database before deploying the phone takeout UI.
-- This adds only the optional customer link; existing session rows are preserved.
ALTER TABLE table_sessions
  ADD COLUMN pickup_customer_id BIGINT UNSIGNED NULL AFTER pickup_phone,
  ADD KEY idx_table_sessions_pickup_customer (pickup_customer_id),
  ADD CONSTRAINT fk_table_sessions_pickup_customer
    FOREIGN KEY (pickup_customer_id) REFERENCES customers (customer_id)
    ON DELETE SET NULL ON UPDATE CASCADE;
