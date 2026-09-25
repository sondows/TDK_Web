import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });

const catalog = [
  ["KIMCHI_PORK", "흑돼지김치찌개", "Kimchi Stew", "김치찌개", "10000.00", 1, 1],
  ["KIMCHI_MOKSAL", "목살김치찌개", "Kimchi Stew", "김치찌개", "11000.00", 1, 2],
  ["KIMCHI_BULGOGI", "불고기김치찌개", "Beef bulgogi kimchi Stew", "김치찌개", "11000.00", 1, 3],
  ["KIMCHI_TUNA", "참치김치찌개", "Tuna Kimchi Stew", "김치찌개", "10000.00", 1, 4],
  ["KIMCHI_SAURY", "꽁치김치찌개", "Mackerel Kimchi Stew", "김치찌개", "11000.00", 1, 5],

  ["SIDE_MACKEREL", "고등어구이", "Grilled mackerel", "사이드", "8000.00", 0, 1],
  ["SIDE_EGGROLL", "계란말이", "Egg roll", "사이드", "4000.00", 0, 2],
  ["EXTRA_DUMPLING", "만두사리", "Dumplings", "사이드", "3000.00", 0, 3],
  ["EXTRA_HAM", "햄사리", "Ham", "사이드", "3000.00", 0, 4],
  ["EXTRA_UDON", "우동사리", null, "사이드", "1500.00", 0, 5],
  ["EXTRA_RAMEN", "라면사리", "Noodles", "사이드", "1000.00", 0, 6],
  ["SIDE_RICE", "공기밥", "Boiled rice", "사이드", "1000.00", 0, 7],
  ["SIDE_SEASONED_LAVER", "김가루", "Seasoned laver", "사이드", "1000.00", 0, 8],
  ["SIDE_DRY_SEAWEED", "도시락김", "Dried seaweed", "사이드", "1000.00", 0, 9],

  ["DRINK_SOJU", "소주", "Soju", "주류·음료", "5000.00", 0, 1],
  ["DRINK_BEER", "맥주", "Beer", "주류·음료", "5000.00", 0, 2],
  ["DRINK_SOFT", "음료", "Beverage", "주류·음료", "2000.00", 0, 3],
  ["DRINK_MAKGEOLLI", "막걸리", "Makguli", "주류·음료", "3000.00", 0, 4],

  ["EXTRA_PORK", "흑돼지추가", "Pork Shoulder", "추가", "8000.00", 0, 1],
  ["EXTRA_MOKSAL", "목살추가", "Pork boston butt", "추가", "9000.00", 0, 2],
  ["EXTRA_BULGOGI", "불고기추가", "Beef bulgogi", "추가", "9000.00", 0, 3],
  ["EXTRA_TUNA", "참치추가", "Tuna", "추가", "6000.00", 0, 4],
  ["EXTRA_SAURY", "꽁치추가", "Mackerel", "추가", "7000.00", 0, 5],
  ["EXTRA_KIMCHI", "찌개김치추가", "Kimchi(200g)", "추가", "4000.00", 0, 6],
  ["EXTRA_TOFU", "두부추가", "Bean curd(200g)", "추가", "1000.00", 0, 7],
  ["EXTRA_VEGETABLE", "야채추가", "Vegetable", "추가", "1000.00", 0, 8],
  ["EXTRA_RAW_EGG", "날계란", "Egg", "추가", "500.00", 0, 9],

  ["PACK_CONTAINER", "포장용기", "Packing", "포장", "500.00", 0, 1],
  ["PACK_PORK_EASY", "흑돼지간편포장", "Kimchi stew", "포장", "7000.00", 0, 2],
  ["PACK_MOKSAL_EASY", "목살간편포장", "Pork Kimchi Stew", "포장", "7700.00", 1, 3],
  ["PACK_BULGOGI_EASY", "불고기간편포장", "Beef bulgogi Kimchi stew", "포장", "7700.00", 0, 4],
  ["PACK_TUNA_EASY", "참치간편포장", "Tuna-Kimchi Stew", "포장", "7000.00", 1, 5],
  ["PACK_SAURY_EASY", "꽁치간편포장", "Mackerel Kimchi Stew", "포장", "7700.00", 1, 6],
  ["PACK_SIDE_DISH", "반찬포장", "Side dish take-out", "포장", "3000.00", 0, 7],
  ["PACK_BROTH", "육수포장", "Broth packing", "포장", "1500.00", 0, 8],
];

const categorySortOrders = new Map([
  ["김치찌개", 1],
  ["사이드", 2],
  ["주류·음료", 3],
  ["추가", 4],
  ["포장", 5],
]);

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function ensureCategory(name) {
  const [rows] = await connection.query(
    "SELECT category_id FROM menu_categories WHERE pos_name = ? ORDER BY category_id",
    [name],
  );
  if (rows.length > 1) throw new Error(`Duplicate menu category: ${name}`);

  const sortOrder = categorySortOrders.get(name);
  if (sortOrder === undefined) throw new Error(`No sort order configured for category: ${name}`);

  if (rows.length === 0) {
    const [result] = await connection.query(
      "INSERT INTO menu_categories (pos_name, sort_order, is_active) VALUES (?, ?, 1)",
      [name, sortOrder],
    );
    return Number(result.insertId);
  }

  const categoryId = Number(rows[0].category_id);
  await connection.query(
    "UPDATE menu_categories SET sort_order = ?, is_active = 1 WHERE category_id = ?",
    [sortOrder, categoryId],
  );
  return categoryId;
}

async function ensureMenu([menuCode, posName, englishName, , price, countsAsPerson, sortOrder], categoryId) {
  const [rows] = await connection.query(
    "SELECT menu_id FROM menus WHERE menu_code = ? ORDER BY menu_id",
    [menuCode],
  );
  if (rows.length > 1) throw new Error(`Duplicate menu code: ${menuCode}`);

  let menuId;
  if (rows.length === 0) {
    const [result] = await connection.query(
      "INSERT INTO menus (menu_code, pos_name, category_id, price, is_active, is_qr_visible, counts_as_person, sort_order) VALUES (?, ?, ?, ?, 1, 1, ?, ?)",
      [menuCode, posName, categoryId, price, countsAsPerson, sortOrder],
    );
    menuId = Number(result.insertId);
  } else {
    menuId = Number(rows[0].menu_id);
    await connection.query(
      "UPDATE menus SET pos_name = ?, category_id = ?, price = ?, is_active = 1, counts_as_person = ?, sort_order = ? WHERE menu_id = ?",
      [posName, categoryId, price, countsAsPerson, sortOrder, menuId],
    );
  }

  if (englishName) {
    await connection.query(
      "INSERT INTO menu_translations (menu_id, language_code, name, description) VALUES (?, 'en', ?, NULL) ON DUPLICATE KEY UPDATE name = VALUES(name)",
      [menuId, englishName],
    );
  }
}

try {
  await connection.beginTransaction();

  const categoryIds = new Map();
  for (const categoryName of categorySortOrders.keys()) {
    categoryIds.set(categoryName, await ensureCategory(categoryName));
  }

  for (const menu of catalog) {
    await ensureMenu(menu, categoryIds.get(menu[3]));
  }

  await connection.commit();
  console.log(`Current store menu catalog synced: ${catalog.length} active menus.`);
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
