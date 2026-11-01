/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash, randomBytes, scrypt } = require("node:crypto");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

const origin = "http://localhost:3000";
const sha256 = value => createHash("sha256").update(value).digest("hex");
const hashPassword = value => new Promise((resolve, reject) => {
  const salt = randomBytes(16).toString("hex");
  scrypt(value, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
    error ? reject(error) : resolve(`scrypt$16384$8$1$${salt}$${key.toString("hex")}`));
});
function newPin() {
  for (;;) {
    const value = String(Number.parseInt(randomBytes(4).toString("hex"), 16) % 1000000).padStart(6, "0");
    if (!/^([0-9])\1{5}$/.test(value) && !"0123456789".includes(value) &&
      !"9876543210".includes(value) && value.slice(0, 3) !== value.slice(3)) return value;
  }
}
function check(value, label) { if (!value) throw new Error(label); }
async function request(path, body, cookie = "") {
  const response = await fetch(origin + path, { method: "POST", headers: {
    origin, "content-type": "application/json", ...(cookie ? { cookie } : {}),
  }, body: JSON.stringify(body) });
  return { status: response.status, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    body: await response.json().catch(() => null) };
}
async function status(path, cookie) {
  const response = await fetch(origin + path, { headers: { cookie } });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function main() {
  if (process.env.DB_NAME !== "TDK_POS_TEST") throw new Error("Only TDK_POS_TEST is allowed");
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const suffix = randomBytes(6).toString("hex");
  const ownerLogin = `reset-owner-${suffix}`.slice(0, 32);
  const targetLogin = `reset-test-${suffix}`.slice(0, 32);
  const ownerCode = `RST-O-${suffix}`;
  const targetCode = `RST-T-${suffix}`;
  const ownerPassword = `Ow8#${randomBytes(18).toString("base64url")}`;
  const oldPassword = `Tg6#${randomBytes(18).toString("base64url")}`;
  const newPassword = `Nt7#${randomBytes(18).toString("base64url")}`;
  const pin = newPin();
  let ownerId = 0, targetId = 0;
  const tokenIds = [];
  try {
    const [schemaRows] = await db.execute("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('staff','staff_sessions','program_trust_tokens')");
    const columns = new Set(schemaRows.map(row => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
    for (const required of ["staff.security_password_hash", "staff.employee_pin_hash",
      "staff.security_password_change_required",
      "staff_sessions.trust_token_id", "program_trust_tokens.program", "program_trust_tokens.revoked_at"])
      check(columns.has(required), `Missing test schema field ${required}`);

    const [ownerInsert] = await db.execute("INSERT INTO staff " +
      "(staff_code,name,admin_login_id,employee_pin_hash,security_password_hash,pos_enabled,kds_enabled,admin_enabled,is_active,role) " +
      "VALUES (?, 'Credential Reset Test Owner', ?, ?, ?, 1,1,1,1,'OWNER')",
    [ownerCode, ownerLogin, await hashPassword("024680"), await hashPassword(ownerPassword)]);
    ownerId = Number(ownerInsert.insertId);
    await db.execute("INSERT INTO admin_security_owners (staff_id,password_hash,credential_state) VALUES (?,?,'ACTIVE')",
      [ownerId, await hashPassword(ownerPassword)]);
    const ownerTrust = randomBytes(32).toString("base64url");
    const [ownerToken] = await db.execute("INSERT INTO program_trust_tokens (program,token_hash,enrolled_by_staff_id) " +
      "VALUES ('ADM',?,?)", [sha256(ownerTrust), ownerId]);
    const ownerSession = `admin.${randomBytes(32).toString("base64url")}`;
    await db.execute("INSERT INTO staff_sessions (staff_id,trust_token_id,session_token_hash,session_type,status,owner_reauthenticated_at) " +
      "VALUES (?,?,?,'ADMIN','ACTIVE',NOW())",
    [ownerId, Number(ownerToken.insertId), sha256(ownerSession)]);
    const ownerCookies = `tdk_admin_session=${ownerSession}; tdk_adm_trust_${ownerToken.insertId}=${ownerTrust}`;

    const [targetInsert] = await db.execute("INSERT INTO staff " +
      "(staff_code,name,admin_login_id,security_password_hash,security_password_change_required," +
      "employee_pin_hash,pos_enabled,kds_enabled,admin_enabled,is_active,role) " +
      "VALUES (?, 'Credential Reset Test Employee', ?, ?,0,?,1,1,1,1,'STAFF')",
    [targetCode, targetLogin, await hashPassword(oldPassword), await hashPassword("135791")]);
    targetId = Number(targetInsert.insertId);
    const programTokens = {};
    let targetAdminSession = "";
    for (const program of ["POS", "ADM", "KDS", "HOS"]) {
      const value = randomBytes(32).toString("base64url");
      const [created] = await db.execute("INSERT INTO program_trust_tokens (program,token_hash,enrolled_by_staff_id) VALUES (?,?,?)",
        [program, sha256(value), targetId]);
      const tokenId = Number(created.insertId);
      tokenIds.push(tokenId);
      programTokens[program] = { value, tokenId };
      if (program !== "HOS") {
        const type = program === "ADM" ? "ADMIN" : program;
        const sessionToken = program === "ADM" ?
          (targetAdminSession = `admin.${randomBytes(32).toString("base64url")}`) :
          `${program}.${randomBytes(20).toString("hex")}`;
        await db.execute("INSERT INTO staff_sessions (staff_id,trust_token_id,session_token_hash,session_type,status) " +
          "VALUES (?,?,?,?,'ACTIVE')", [targetId, tokenId, sha256(sessionToken), type]);
      }
    }

    const unprivilegedCookie = `tdk_admin_session=${targetAdminSession}; ` +
      `tdk_adm_trust_${programTokens.ADM.tokenId}=${programTokens.ADM.value}`;
    const denied = await request(`/api/admin-center/staff/${targetId}/security-password`, { confirmed: true }, unprivilegedCookie);
    check(denied.status === 403, `Authenticated non-owner reset request was not denied (HTTP ${denied.status})`);

    const reset = await request(`/api/admin-center/staff/${targetId}/security-password`, { confirmed: true }, ownerCookies);
    check(reset.status === 200 && reset.body?.success === true, `Owner reset failed (HTTP ${reset.status})`);
    check(!("temporaryPassword" in (reset.body ?? {})), "Reset endpoint returned a password");

    const [stateRows] = await db.execute("SELECT security_password_hash,security_password_change_required,employee_pin_hash," +
      "is_active,role,pos_enabled,kds_enabled,admin_enabled FROM staff WHERE staff_id=?", [targetId]);
    const state = stateRows[0];
    check(state.security_password_hash === null && Number(state.security_password_change_required) === 1,
      "Master-password reset state was not recorded");
    check(state.employee_pin_hash === null, "The shared employee PIN hash survived reset");
    check(Number(state.is_active) === 1 && state.role === "STAFF" && Number(state.pos_enabled) === 1 &&
      Number(state.kds_enabled) === 1 && Number(state.admin_enabled) === 1,
    "Reset changed account status or permissions");
    const oldTrustStatus = {};
    for (const [program, path, cookieName] of [
      ["POS", "/api/auth/trust", "tdk_pos_trust"],
      ["ADM", "/api/admin-center/trust", "tdk_adm_trust"],
      ["KDS", "/api/kitchen/auth/trust", "tdk_kds_trust"],
    ]) {
      const old = programTokens[program];
      const current = await status(path, `${cookieName}_${old.tokenId}=${old.value}`);
      oldTrustStatus[program] = current.status;
      check(current.status === 200 && current.body?.trusted === false,
        `${program} accepted a revoked trust cookie`);
    }
    const [accessRows] = await db.execute("SELECT " +
      "(SELECT COUNT(*) FROM program_trust_tokens WHERE enrolled_by_staff_id=? AND revoked_at IS NULL) AS active_tokens," +
      "(SELECT COUNT(*) FROM program_trust_tokens WHERE enrolled_by_staff_id=? AND revoke_reason='CREDENTIALS_RESET') AS reset_tokens," +
      "(SELECT COUNT(*) FROM staff_sessions WHERE staff_id=? AND status='ACTIVE') AS active_sessions," +
      "(SELECT COUNT(*) FROM audit_logs WHERE staff_id=? AND action_type='STAFF_CREDENTIALS_RESET' AND entity_id=?) AS audits",
    [targetId,targetId,targetId,ownerId,targetId]);
    check(Number(accessRows[0].active_tokens) === 0 && Number(accessRows[0].reset_tokens) === 4 &&
      Number(accessRows[0].active_sessions) === 0 && Number(accessRows[0].audits) === 1,
    "Token, session or audit reset result is incomplete");

    const [otherEmployee] = await db.execute("SELECT COUNT(*) AS count FROM staff WHERE staff_id<>? AND staff_code=?", [targetId, ownerCode]);
    check(Number(otherEmployee[0].count) === 1, "Another employee fixture was changed unexpectedly");
    const resetStatus = await request("/api/admin-center/trust/initial-master/status", { loginId: targetLogin });
    check(resetStatus.status === 200 && resetStatus.body?.resetPasswordRequired === true,
      `Reset re-registration status was not available (${resetStatus.status}; ${JSON.stringify(resetStatus.body)})`);
    const unauthorizedRegistration = await request("/api/program-trust/master-recovery/register-initial", {
      loginId: ownerLogin, password: newPassword, confirmPassword: newPassword,
    });
    check(unauthorizedRegistration.status === 409, "Unreset account could register a master password");
    const registration = await request("/api/program-trust/master-recovery/register-initial", {
      loginId: targetLogin, password: newPassword, confirmPassword: newPassword,
    });
    check(registration.status === 200 && registration.body?.success === true,
      `Master-password re-registration failed (HTTP ${registration.status})`);
    const [registeredRows] = await db.execute("SELECT security_password_hash,security_password_change_required FROM staff WHERE staff_id=?", [targetId]);
    check(Boolean(registeredRows[0].security_password_hash) && Number(registeredRows[0].security_password_change_required) === 0,
      "Re-registration did not save the hash and clear the one-time state");
    const oldPasswordLogin = await request("/api/admin-center/trust", { loginId: targetLogin, password: oldPassword });
    check(oldPasswordLogin.status === 401, "Old master password still authenticates");
    const login = await request("/api/admin-center/trust", { loginId: targetLogin, password: newPassword });
    check(login.status === 200 && login.cookie && login.body?.pinSetupRequired === true,
      "New password did not issue an ADM token or show PIN setup");
    const pinSetup = await request("/api/program-trust/pin", {
      program: "ADM", loginId: targetLogin, pin, confirmPin: pin,
    }, login.cookie);
    check(pinSetup.status === 200 && pinSetup.body?.sessionCreated === true,
      `PIN registration after reset failed (HTTP ${pinSetup.status})`);
    const [complete] = await db.execute("SELECT security_password_hash IS NOT NULL AS password_set," +
      "employee_pin_hash IS NOT NULL AS pin_set,security_password_change_required AS reset_pending FROM staff WHERE staff_id=?", [targetId]);
    check(Number(complete[0].password_set) === 1 && Number(complete[0].pin_set) === 1 &&
      Number(complete[0].reset_pending) === 0, "Master password and PIN registration did not complete");
    process.stdout.write(JSON.stringify({ db: "TDK_POS_TEST", reset: reset.status, nonOwnerDenied: denied.status,
      tokenRowsRevoked: Number(accessRows[0].reset_tokens), activeSessionsAfterReset: Number(accessRows[0].active_sessions),
      oldTrustStatus,
      resetStatus: resetStatus.status, unauthorizedRegistration: unauthorizedRegistration.status,
      reRegistration: registration.status, oldPassword: oldPasswordLogin.status, newMasterLogin: login.status,
      pinRegistration: pinSetup.status, cleanup: "pending" }) + "\n");
  } finally {
    try {
      await db.beginTransaction();
      for (const id of [targetId, ownerId].filter(Boolean)) {
        await db.execute("DELETE FROM admin_security_owners WHERE staff_id=?", [id]);
        await db.execute("DELETE FROM staff_sessions WHERE staff_id=?", [id]);
        await db.execute("DELETE FROM program_trust_tokens WHERE enrolled_by_staff_id=?", [id]);
        await db.execute("DELETE FROM audit_logs WHERE staff_id=? OR (entity_id=? AND action_type='STAFF_CREDENTIALS_RESET')", [id,targetId]);
        await db.execute("DELETE FROM staff WHERE staff_id=?", [id]);
      }
      for (const login of [ownerLogin, targetLogin]) {
        const attemptKey = sha256(`master-password-initial:account:${login}`);
        await db.execute("DELETE FROM admin_auth_attempts WHERE attempt_key=?", [attemptKey]);
      }
      await db.commit();
      process.stdout.write(JSON.stringify({ db: "TDK_POS_TEST", fixtureCleanup: "complete" }) + "\n");
    } catch (error) {
      await db.rollback().catch(() => {});
      console.error("Credential reset fixture cleanup failed", { code: error.code ?? error.name, ownerId, targetId });
      throw error;
    } finally { await db.end(); }
  }
}
main().catch(error => { console.error("Credential reset integration failed", { message: error.message, code: error.code ?? error.name });
  process.exitCode = 1; });
