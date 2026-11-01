/* eslint-disable @typescript-eslint/no-require-imports */
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

async function main() {
  if (process.env.DB_NAME !== "TDK_POS_TEST") throw new Error("This check only permits TDK_POS_TEST");
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  try {
    const [columns] = await connection.query(
      "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND " +
      "TABLE_NAME IN ('staff','staff_sessions','program_trust_tokens','staff_security_invites','security_bootstrap_state') ORDER BY TABLE_NAME,COLUMN_NAME");
    const required = {
      staff: ["security_password_hash", "employee_pin_hash", "terminated_at"],
      staff_sessions: ["trust_token_id"],
      program_trust_tokens: ["token_id", "program", "token_hash", "enrolled_by_staff_id", "created_at", "last_used_at", "revoked_at", "client_label", "revoke_reason"],
      staff_security_invites: ["invite_id", "staff_id", "invite_hash", "expires_at", "used_at"],
      security_bootstrap_state: ["state_id", "completed_at"],
    };
    const missing = Object.entries(required).flatMap(([table, names]) =>
      names.filter(name => !columns.some(column => column.TABLE_NAME === table && column.COLUMN_NAME === name))
        .map(name => `${table}.${name}`));
    const programType = columns.find(column => column.TABLE_NAME === "program_trust_tokens" && column.COLUMN_NAME === "program")?.COLUMN_TYPE;
    const hasHosStaffPermission = columns.some(column => column.TABLE_NAME === "staff" && column.COLUMN_NAME === "hos_enabled");
    if (programType !== "enum('POS','ADM','KDS','HOS')") missing.push("program_trust_tokens.program enum");
    for (const name of ["device_id", "managed_device_id", "trust_token_id"]) {
      const column = columns.find(item => item.TABLE_NAME === "staff_sessions" && item.COLUMN_NAME === name);
      if (column && column.IS_NULLABLE !== "YES") missing.push(`staff_sessions.${name} must be nullable`);
    }
    if (missing.length) throw Object.assign(new Error("Test schema is incomplete"), { code: "SCHEMA_INCOMPLETE", missing });
    const [staff] = await connection.query(
      "SELECT COUNT(*) AS staff_rows, SUM(staff_code<>'000') AS individual_rows, " +
      "SUM(is_active=1 AND admin_enabled=1 AND employee_pin_hash IS NOT NULL AND employee_pin_hash<>'') AS adm_pin_ready, " +
      "SUM(is_active=1 AND admin_enabled=1 AND security_password_hash IS NOT NULL AND security_password_hash<>'') AS adm_password_ready " +
      "FROM staff");
    const [owners] = await connection.query(
      "SELECT COUNT(*) AS owner_rows, " +
      "SUM(credential_state='ACTIVE' AND password_hash IS NOT NULL AND password_hash<>'') AS owner_second_factor_ready " +
      "FROM admin_security_owners");
    const [tokens] = await connection.query("SELECT COUNT(*) AS token_rows FROM program_trust_tokens");
    const [invites] = await connection.query("SELECT COUNT(*) AS invite_rows FROM staff_security_invites");
    const [latch] = await connection.query("SELECT completed_at FROM security_bootstrap_state WHERE state_id=1");
    if (Number(staff[0].individual_rows) > 0 && !latch[0]?.completed_at)
      throw Object.assign(new Error("Existing staff database left first-owner setup open"), {
        code: "BOOTSTRAP_NOT_CLOSED",
      });
    process.stdout.write(JSON.stringify({
      db: "TDK_POS_TEST", schema: "ready", staffRows: Number(staff[0].staff_rows),
      tokenRows: Number(tokens[0].token_rows),
      inviteRows: Number(invites[0].invite_rows),
      admPinReady: Number(staff[0].adm_pin_ready || 0),
      admPasswordReady: Number(staff[0].adm_password_ready || 0),
      ownerSecondFactorReady: Number(owners[0].owner_second_factor_ready || 0),
      bootstrapClosed: Boolean(latch[0]?.completed_at),
      hasHosStaffPermission,
    }) + "\n");
  } finally { await connection.end(); }
}
main().catch(error => {
  console.error("Test DB check failed", { code: error.code ?? error.name, missing: error.missing });
  process.exitCode = 1;
});
