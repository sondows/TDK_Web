import dotenv from "dotenv";
import mysql from "mysql2/promise";
dotenv.config({ path: ".env.local" });
const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER?.trim(), password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const [rows] = await connection.query("SHOW COLUMNS FROM dining_tables");
console.log(JSON.stringify(rows.filter((row) => ["position_x", "position_y", "layout_width", "layout_height", "rotation"].includes(row.Field)), null, 2));
await connection.end();
