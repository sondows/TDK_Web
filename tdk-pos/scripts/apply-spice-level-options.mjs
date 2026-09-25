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

const levels = ["안매움", "순한맛", "약간매운맛", "매운맛"];

try {
  await connection.beginTransaction();
  const [groups] = await connection.query("SELECT modifier_group_id FROM modifier_groups WHERE pos_name = ? AND is_active = 1 ORDER BY modifier_group_id", ["매운맛"]);
  if (groups.length !== 1) throw new Error("활성 매운맛 modifier group을 하나로 확인할 수 없습니다.");
  const groupId = Number(groups[0].modifier_group_id);

  await connection.query("UPDATE modifier_options SET is_active = 0 WHERE modifier_group_id = ? AND pos_name IN (?, ?)", [groupId, "기본", "약간 매운맛"]);

  for (const [index, name] of levels.entries()) {
    const [rows] = await connection.query("SELECT modifier_option_id FROM modifier_options WHERE modifier_group_id = ? AND pos_name = ? ORDER BY modifier_option_id", [groupId, name]);
    if (rows.length > 1) throw new Error(`중복 매운맛 옵션: ${name}`);
    if (rows.length === 0) {
      await connection.query("INSERT INTO modifier_options (modifier_group_id, pos_name, price_delta, linked_menu_id, sort_order, is_active) VALUES (?, ?, '0.00', NULL, ?, 1)", [groupId, name, (index + 1) * 10]);
    } else {
      await connection.query("UPDATE modifier_options SET price_delta = '0.00', linked_menu_id = NULL, sort_order = ?, is_active = 1 WHERE modifier_option_id = ?", [(index + 1) * 10, Number(rows[0].modifier_option_id)]);
    }
  }
  await connection.commit();
  console.log("Spice-level modifier options applied.");
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
