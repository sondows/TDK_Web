import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });

const translations = [
  ["흑돼지김치찌개", "Black Pork Kimchi Stew"],
  ["목살김치찌개", "Pork Neck Kimchi Stew"],
  ["불고기김치찌개", "Bulgogi Kimchi Stew"],
  ["참치김치찌개", "Tuna Kimchi Stew"],
  ["꽁치김치찌개", "Saury Kimchi Stew"],
  ["고등어구이", "Grilled Mackerel"],
  ["계란말이", "Rolled Omelet"],
  ["만두사리", "Dumpling Add-on"],
  ["햄사리", "Ham Add-on"],
  ["우동사리", "Udon Noodles"],
  ["라면사리", "Ramen Noodles"],
  ["공기밥", "Steamed Rice"],
  ["김가루", "Seasoned Seaweed Flakes"],
  ["도시락김", "Roasted Seaweed"],
  ["소주", "Soju"],
  ["맥주", "Beer"],
  ["음료", "Soft Drink"],
  ["막걸리", "Makgeolli"],
  ["흑돼지추가", "Black Pork Add-on"],
  ["목살추가", "Pork Neck Add-on"],
  ["불고기추가", "Bulgogi Add-on"],
  ["참치추가", "Tuna Add-on"],
  ["꽁치추가", "Saury Add-on"],
  ["찌개김치추가", "Extra Kimchi (200g)"],
  ["두부추가", "Extra Tofu (200g)"],
  ["야채추가", "Extra Vegetables"],
  ["날계란", "Raw Egg"],
  ["포장용기", "Takeout Container"],
  ["흑돼지간편포장", "Black Pork Kimchi Stew (Takeout)"],
  ["목살간편포장", "Pork Neck Kimchi Stew (Takeout)"],
  ["불고기간편포장", "Bulgogi Kimchi Stew (Takeout)"],
  ["참치간편포장", "Tuna Kimchi Stew (Takeout)"],
  ["꽁치간편포장", "Saury Kimchi Stew (Takeout)"],
  ["반찬포장", "Takeout Side Dishes"],
  ["육수포장", "Broth (Takeout)"],
];

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

try {
  await connection.beginTransaction();

  for (const [posName, name] of translations) {
    const [menus] = await connection.query(
      "SELECT menu_id FROM menus WHERE pos_name = ? ORDER BY menu_id",
      [posName],
    );
    if (menus.length !== 1) throw new Error(`Expected exactly one menu for name: ${posName}`);

    await connection.query(
      "INSERT INTO menu_translations (menu_id, language_code, name, description) VALUES (?, 'en', ?, NULL) ON DUPLICATE KEY UPDATE name = VALUES(name)",
      [Number(menus[0].menu_id), name],
    );
  }

  await connection.commit();
  console.log(`English menu translations synced: ${translations.length}.`);
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
