import { randomBytes, scrypt } from "node:crypto";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const staffCode = "001";
const staffName = "손창호";
const ownerPin = process.env.OWNER_PIN;

if (!ownerPin) {
  console.error("OWNER_PIN 환경 변수가 설정되지 않았습니다.");
  process.exit(1);
}

function hashPin(pin) {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16).toString("hex");
    scrypt(
      pin,
      salt,
      64,
      { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(`scrypt$16384$8$1$${salt}$${derivedKey.toString("hex")}`);
      }
    );
  });
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

try {
  const [existingStaff] = await connection.execute(
    "SELECT staff_id FROM staff WHERE staff_code = ? LIMIT 1",
    [staffCode]
  );

  if (existingStaff.length > 0) {
    console.error("직원코드 001이 이미 존재합니다. 기존 계정은 변경하지 않았습니다.");
    process.exitCode = 1;
  } else {
    const pinHash = await hashPin(ownerPin);
    await connection.execute(
      "INSERT INTO staff (staff_code, name, pin_hash, role, is_active) VALUES (?, ?, ?, 'OWNER', 1)",
      [staffCode, staffName, pinHash]
    );
    console.log("OWNER 계정을 생성했습니다.");
  }
} finally {
  await connection.end();
  delete process.env.OWNER_PIN;
}
