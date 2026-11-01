/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash } = require("node:crypto");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

async function main() {
  if (process.env.DB_NAME !== "TDK_POS_TEST") throw new Error("Only TDK_POS_TEST is allowed");
  const db = await mysql.createConnection({ host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  try {
    const [rows] = await db.execute("SELECT s.staff_id,s.is_active,s.admin_enabled,s.terminated_at," +
      "s.employee_pin_hash,s.security_password_hash,o.staff_id AS owner_id,o.credential_state," +
      "o.password_hash AS owner_password_hash FROM staff s " +
      "LEFT JOIN admin_security_owners o ON o.staff_id=s.staff_id " +
      "WHERE LOWER(s.admin_login_id)=LOWER(?) LIMIT 2", ["sondows"]);
    const row = rows.length === 1 ? rows[0] : null;
    const attemptKey = createHash("sha256").update("trust-enroll-adm:account:sondows").digest("hex");
    const [attempts] = await db.execute("SELECT attempt_count,window_started_at>DATE_SUB(NOW(),INTERVAL 15 MINUTE) AS recent " +
      "FROM admin_auth_attempts WHERE attempt_key=?", [attemptKey]);
    const [grants] = await db.execute("SELECT COUNT(*) AS total_count," +
      "COALESCE(SUM(used_at IS NULL AND revoked_at IS NULL AND expires_at>NOW()),0) AS active_count," +
      "COALESCE(SUM(used_at IS NULL AND revoked_at IS NULL AND expires_at<=NOW()),0) AS expired_count," +
      "COALESCE(SUM(revoked_at IS NOT NULL),0) AS revoked_count " +
      "FROM master_password_recovery_grants WHERE staff_id=?", [row?.staff_id || 0]);
    process.stdout.write(JSON.stringify({ db: "TDK_POS_TEST", loginId: "sondows",
      matchingRows: rows.length, staffId: row?.staff_id ?? null,
      active: row?.is_active === 1, terminated: Boolean(row?.terminated_at),
      admEnabled: row?.admin_enabled === 1, owner: Boolean(row?.owner_id),
      ownerCredentialState: row?.credential_state ?? null,
      ownerSecondFactorConfigured: Boolean(row?.owner_password_hash),
      personalPinConfigured: Boolean(row?.employee_pin_hash),
      programPasswordConfigured: Boolean(row?.security_password_hash),
      programPasswordColumnNull: row?.security_password_hash === null,
      programPasswordFormat: row?.security_password_hash?.startsWith("scrypt$") ? "scrypt" :
        row?.security_password_hash ? "other" : "none",
      masterLoginLocked: Boolean(attempts[0]?.recent && attempts[0]?.attempt_count >= 5),
      activeRecoveryGrants: Number(grants[0]?.active_count || 0),
      expiredRecoveryGrants: Number(grants[0]?.expired_count || 0),
      revokedRecoveryGrants: Number(grants[0]?.revoked_count || 0),
    }) + "\n");
  } finally { await db.end(); }
}
main().catch(error => { console.error("Owner first-auth check failed", { code: error.code ?? error.name });
  process.exitCode = 1; });
