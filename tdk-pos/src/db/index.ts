import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";

const poolRegistry = globalThis as typeof globalThis & {
  __tdkonMysqlPool?: ReturnType<typeof mysql.createPool>;
};

export const pool = poolRegistry.__tdkonMysqlPool ?? mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

poolRegistry.__tdkonMysqlPool = pool;

export const db = drizzle({
  client: pool,
});
