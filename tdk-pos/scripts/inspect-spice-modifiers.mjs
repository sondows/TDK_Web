import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

try {
  const [groups] = await connection.query("SELECT modifier_group_id, pos_name, min_select, max_select, is_required, is_active, sort_order FROM modifier_groups ORDER BY modifier_group_id");
  const [options] = await connection.query("SELECT mo.modifier_option_id, mo.modifier_group_id, mg.pos_name AS group_name, mo.pos_name, mo.price_delta, mo.is_active, mo.sort_order, COUNT(oio.order_item_option_id) AS order_usage FROM modifier_options mo JOIN modifier_groups mg ON mg.modifier_group_id = mo.modifier_group_id LEFT JOIN order_item_options oio ON oio.modifier_option_id = mo.modifier_option_id GROUP BY mo.modifier_option_id, mo.modifier_group_id, mg.pos_name, mo.pos_name, mo.price_delta, mo.is_active, mo.sort_order ORDER BY mo.modifier_group_id, mo.sort_order, mo.modifier_option_id");
  const [links] = await connection.query("SELECT m.menu_id, m.pos_name, mmg.modifier_group_id, mg.pos_name AS group_name FROM menu_modifier_groups mmg JOIN menus m ON m.menu_id = mmg.menu_id JOIN modifier_groups mg ON mg.modifier_group_id = mmg.modifier_group_id ORDER BY m.menu_id, mmg.sort_order");
  console.log(JSON.stringify({ groups, options, links }, null, 2));
} finally {
  await connection.end();
}
