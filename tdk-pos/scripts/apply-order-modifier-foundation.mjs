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

const personMenuCodes = [
  "KIMCHI_PORK",
  "KIMCHI_MOKSAL",
  "KIMCHI_BULGOGI",
  "KIMCHI_TUNA",
  "KIMCHI_SAURY",
];

const addonMenuCodes = ["EXTRA_HAM", "EXTRA_DUMPLING", "EXTRA_UDON", "EXTRA_RAMEN"];

async function ensureCountsAsPersonColumn() {
  const [columns] = await connection.query("SHOW COLUMNS FROM menus LIKE 'counts_as_person'");
  if (columns.length === 0) {
    await connection.query("ALTER TABLE menus ADD COLUMN counts_as_person TINYINT(1) NOT NULL DEFAULT 0 AFTER is_qr_visible");
  }

  const [indexes] = await connection.query("SHOW INDEX FROM menus WHERE Key_name = 'idx_menus_counts_as_person_active'");
  if (indexes.length === 0) {
    await connection.query("CREATE INDEX idx_menus_counts_as_person_active ON menus (counts_as_person, is_active)");
  }
}

async function ensureSingleGroup({ name, minSelect, maxSelect, required, sortOrder }) {
  const [rows] = await connection.query("SELECT modifier_group_id FROM modifier_groups WHERE pos_name = ? ORDER BY modifier_group_id", [name]);
  if (rows.length > 1) throw new Error(`Duplicate modifier group: ${name}`);
  if (rows.length === 0) {
    const [result] = await connection.query(
      "INSERT INTO modifier_groups (pos_name, min_select, max_select, is_required, is_active, sort_order) VALUES (?, ?, ?, ?, 1, ?)",
      [name, minSelect, maxSelect, required, sortOrder],
    );
    return Number(result.insertId);
  }
  const id = Number(rows[0].modifier_group_id);
  await connection.query(
    "UPDATE modifier_groups SET min_select = ?, max_select = ?, is_required = ?, is_active = 1, sort_order = ? WHERE modifier_group_id = ?",
    [minSelect, maxSelect, required, sortOrder, id],
  );
  return id;
}

async function ensureOption({ groupId, name, priceDelta, linkedMenuId, sortOrder }) {
  const [rows] = await connection.query(
    "SELECT modifier_option_id FROM modifier_options WHERE modifier_group_id = ? AND pos_name = ? ORDER BY modifier_option_id",
    [groupId, name],
  );
  if (rows.length > 1) throw new Error(`Duplicate modifier option: ${name}`);
  if (rows.length === 0) {
    await connection.query(
      "INSERT INTO modifier_options (modifier_group_id, pos_name, price_delta, linked_menu_id, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)",
      [groupId, name, priceDelta, linkedMenuId, sortOrder],
    );
    return;
  }
  await connection.query(
    "UPDATE modifier_options SET price_delta = ?, linked_menu_id = ?, sort_order = ?, is_active = 1 WHERE modifier_option_id = ?",
    [priceDelta, linkedMenuId, sortOrder, Number(rows[0].modifier_option_id)],
  );
}

try {
  await ensureCountsAsPersonColumn();
  await connection.beginTransaction();

  const requestedCodes = [...personMenuCodes, ...addonMenuCodes];
  const placeholders = requestedCodes.map(() => "?").join(", ");
  const [menus] = await connection.query(
    `SELECT menu_id, menu_code, pos_name, price FROM menus WHERE menu_code IN (${placeholders})`,
    requestedCodes,
  );
  const menuByCode = new Map(menus.map((menu) => [menu.menu_code, menu]));
  if (menuByCode.size !== requestedCodes.length) throw new Error("Required menu codes are missing.");

  await connection.query(
    `UPDATE menus SET counts_as_person = 1 WHERE menu_code IN (${personMenuCodes.map(() => "?").join(", ")})`,
    personMenuCodes,
  );

  const spiceGroupId = await ensureSingleGroup({ name: "매운맛", minSelect: 1, maxSelect: 1, required: 1, sortOrder: 10 });
  const addonGroupId = await ensureSingleGroup({ name: "추가메뉴", minSelect: 0, maxSelect: 4, required: 0, sortOrder: 20 });

  for (const [index, name] of ["기본", "약간 매운맛", "매운맛"].entries()) {
    await ensureOption({ groupId: spiceGroupId, name, priceDelta: "0.00", linkedMenuId: null, sortOrder: (index + 1) * 10 });
  }

  for (const [index, code] of addonMenuCodes.entries()) {
    const menu = menuByCode.get(code);
    await ensureOption({ groupId: addonGroupId, name: menu.pos_name, priceDelta: menu.price, linkedMenuId: Number(menu.menu_id), sortOrder: (index + 1) * 10 });
  }

  for (const code of personMenuCodes) {
    const menu = menuByCode.get(code);
    for (const [groupId, sortOrder] of [[spiceGroupId, 10], [addonGroupId, 20]]) {
      await connection.query(
        "INSERT INTO menu_modifier_groups (menu_id, modifier_group_id, sort_order) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)",
        [Number(menu.menu_id), groupId, sortOrder],
      );
    }
  }

  await connection.commit();
  console.log("Order modifier foundation applied.");
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
