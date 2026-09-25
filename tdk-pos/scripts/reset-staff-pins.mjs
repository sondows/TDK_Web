import { randomBytes, scrypt } from "crypto";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });

const STAFF_CODES = ["001", "002"];
const RESET_PIN = "0000";

const deriveScryptKey = (pin, salt) => new Promise((resolve, reject) => {
  scrypt(pin, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
});

// This is intentionally the same scrypt format and parameters used by
// src/lib/auth.ts#hashPin. A standalone Node script cannot import the
// server-only TypeScript module without adding a runtime dependency.
const hashPin = async (pin) => {
  const salt = randomBytes(16).toString("hex");
  const key = await deriveScryptKey(pin, salt);
  return `scrypt$16384$8$1$${salt}$${key.toString("hex")}`;
};

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER?.trim(),
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

try {
  const [staffRows] = await connection.execute("SELECT staff_code FROM staff WHERE staff_code IN (?, ?) ORDER BY staff_code", STAFF_CODES);
  if (staffRows.length !== STAFF_CODES.length || staffRows.some((row, index) => row.staff_code !== STAFF_CODES[index])) throw new Error("재설정 대상 직원 001, 002를 모두 찾을 수 없습니다.");

  for (const staffCode of STAFF_CODES) {
    const pinHash = await hashPin(RESET_PIN);
    await connection.execute("UPDATE staff SET pin_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE staff_code = ?", [pinHash, staffCode]);
    console.log(`직원 ${staffCode} PIN 재설정 완료`);
  }
} finally {
  await connection.end();
}
