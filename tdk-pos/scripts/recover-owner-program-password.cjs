/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * NAS administrator only. Issue a 15-minute, one-use recovery link for an
 * existing security owner. The password is entered in the browser only.
 */
const { createHash, randomBytes } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

const options = Object.fromEntries(process.argv.slice(2).map(value => value.split("=", 2)));
const expectedDb = options["--db"];
const staffId = Number(options["--staff-id"]);
const saveLinkLocally = options["--save-link-local"] === "1";
const testTtlMinutes = options["--test-ttl-minutes"] === undefined ? 15 : Number(options["--test-ttl-minutes"]);
if (!["TDK_POS_TEST", "TDK_POS"].includes(expectedDb) || process.env.DB_NAME !== expectedDb ||
  !Number.isSafeInteger(staffId) || staffId <= 0 || !process.stdin.isTTY || !process.stdout.isTTY ||
  (saveLinkLocally && expectedDb !== "TDK_POS_TEST") ||
  !Number.isSafeInteger(testTtlMinutes) || testTtlMinutes < 1 || testTtlMinutes > 60 ||
  (expectedDb === "TDK_POS" && testTtlMinutes !== 15)) {
  console.error("Run in a NAS administrator TTY with --db=TDK_POS_TEST|TDK_POS --staff-id=<existing owner ID>.");
  process.exit(1);
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await connection.beginTransaction();
    let loginId;
    try {
      const [owners] = await connection.execute(
        "SELECT s.admin_login_id FROM staff s " +
        "INNER JOIN admin_security_owners o ON o.staff_id=s.staff_id " +
        "WHERE s.staff_id=? AND s.is_active=1 AND s.admin_enabled=1 " +
        "AND s.terminated_at IS NULL AND s.staff_code<>'000' FOR UPDATE", [staffId]);
      if (owners.length !== 1 || !owners[0].admin_login_id)
        throw new Error("Owner is not eligible for recovery");
      loginId = owners[0].admin_login_id;
      await connection.execute(
        "UPDATE master_password_recovery_grants SET revoked_at=NOW() " +
        "WHERE staff_id=? AND used_at IS NULL AND revoked_at IS NULL", [staffId]);
      await connection.execute(
        "INSERT INTO master_password_recovery_grants (staff_id,token_hash,expires_at) " +
        "VALUES (?,?,DATE_ADD(NOW(),INTERVAL ? MINUTE))", [staffId, tokenHash, testTtlMinutes]);
      await connection.execute(
        "INSERT INTO audit_logs (staff_id,action_type,entity_type,entity_id) " +
        "VALUES (?,'MASTER_PASSWORD_RECOVERY_ISSUED','STAFF',?)", [staffId, staffId]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    const origin = expectedDb === "TDK_POS_TEST"
      ? "http://localhost:3000" : "https://tdkon.myasustor.com";
    const fragment = new URLSearchParams({ "master-recovery": token, id: loginId });
    const link = `${origin}/tdkadm/login?recovery=1#${fragment.toString()}`;
    if (saveLinkLocally) {
      const target = resolve(process.cwd(), ".env.master-recovery-link.local");
      writeFileSync(target, `${link}\n`, { encoding: "utf8", mode: 0o600 });
      process.stdout.write(`TEST recovery link saved locally for ${testTtlMinutes} minutes: ${target}\n`);
    } else {
      process.stdout.write(`One-use recovery link for ${loginId} (${testTtlMinutes} minutes):\n${link}\n`);
    }
  } finally { await connection.end(); }
}
main().catch(error => {
  console.error("Master password recovery link failed", { code: error.code ?? "CHECK_OWNER_AND_SCHEMA" });
  process.exitCode = 1;
});
