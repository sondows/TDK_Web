-- Run only after 00_dba_show_view_grant.sql has been approved and applied.
-- This file is read-only. Save each CREATE VIEW result securely for comparison.
-- Do not replace production definitions until all six TEST definitions have
-- been compared, including referenced schema/table names and DEFINER/SECURITY.
SELECT CURRENT_USER() AS effective_account, USER() AS connected_account,
       DATABASE() AS current_database;
SHOW CREATE VIEW TDK_POS_TEST.v_daily_menu_sales;
SHOW CREATE VIEW TDK_POS_TEST.v_daily_theoretical_ingredient_usage;
SHOW CREATE VIEW TDK_POS_TEST.v_inventory_status;
SHOW CREATE VIEW TDK_POS_TEST.v_open_table_sessions;
SHOW CREATE VIEW TDK_POS_TEST.v_session_order_totals;
SHOW CREATE VIEW TDK_POS_TEST.v_supplier_payables;

-- Production definitions are currently readable and may be retrieved separately:
SHOW CREATE VIEW TDK_POS.v_daily_menu_sales;
SHOW CREATE VIEW TDK_POS.v_daily_theoretical_ingredient_usage;
SHOW CREATE VIEW TDK_POS.v_inventory_status;
SHOW CREATE VIEW TDK_POS.v_open_table_sessions;
SHOW CREATE VIEW TDK_POS.v_session_order_totals;
SHOW CREATE VIEW TDK_POS.v_supplier_payables;