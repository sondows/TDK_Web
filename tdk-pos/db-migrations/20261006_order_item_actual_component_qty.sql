-- Keep the existing order_items quantity constraint and store an included
-- component's chosen usage count separately so an explicit zero is preserved.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS actual_component_qty INT NULL AFTER qty;
