-- Data setup for the existing inventory schema. Run against TDK_POS_TEST first.
-- The initial balance is zero; use the POS 공기밥 SET action after a physical count.
INSERT INTO inventory_items (item_code, item_name, item_type, base_unit, tracking_type, current_qty, is_active)
SELECT 'PREPARED_RICE', '공기밥', 'PREPARED', '개', 'REALTIME', 0, 1
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE item_code = 'PREPARED_RICE');

INSERT INTO menu_inventory (menu_id, inventory_item_id, qty_used)
SELECT m.menu_id, i.inventory_item_id, 1
FROM menus AS m
JOIN inventory_items AS i ON i.item_code = 'PREPARED_RICE'
WHERE m.menu_code = 'SIDE_RICE'
  AND NOT EXISTS (
    SELECT 1 FROM menu_inventory AS mi
    WHERE mi.menu_id = m.menu_id AND mi.inventory_item_id = i.inventory_item_id
  );
