/* eslint-disable @typescript-eslint/no-require-imports */
const { randomBytes, scrypt } = require("node:crypto");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

const origin = "http://localhost:3000";
const pin = "017394";
const programs = [
  { name: "POS", trust: "/api/auth/trust", login: "/api/auth/login" },
  { name: "ADM", trust: "/api/admin-center/trust", login: "/api/admin-center/login" },
  { name: "KDS", trust: "/api/kitchen/auth/trust", login: "/api/kitchen/auth/login" },
];
const hashCredential = value => new Promise((resolve, reject) => {
  const salt = randomBytes(16).toString("hex");
  scrypt(value, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
    if (error) reject(error);
    else resolve(`scrypt$16384$8$1$${salt}$${key.toString("hex")}`);
  });
});
async function request(path, method = "GET", body, cookie = "") {
  const response = await fetch(origin + path, {
    method, headers: { origin, ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null),
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
function expect(result, status, label) {
  if (result.status !== status) throw new Error(`${label}: expected ${status}, received ${result.status}`);
}

async function main() {
  if (process.env.DB_NAME !== "TDK_POS_TEST") throw new Error("Only TDK_POS_TEST is allowed");
  const db = await mysql.createConnection({ host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const suffix = randomBytes(6).toString("hex");
  const ownerId = `lifeowner${suffix}`, employeeId = `lifeemp${suffix}`;
  const ownerCode = `LFO-${suffix}`, employeeCode = `LFE-${suffix}`;
  const ownerPassword = `O9!${randomBytes(20).toString("base64url")}`;
  const employeePassword = `E9!${randomBytes(20).toString("base64url")}`;
  const ownerFactor = `F9!${randomBytes(20).toString("base64url")}`;
  let ownerStaffId = null;
  let employeeStaffId = null;
  try {
    const [createdOwner] = await db.execute("INSERT INTO staff " +
      "(staff_code,name,admin_login_id,security_password_hash,employee_pin_hash,role,is_active," +
      "pos_enabled,admin_enabled,kds_enabled,kds_pin_change_required) " +
      "VALUES (?,'Lifecycle Owner',?, ?,?,'OWNER',1,1,1,1,0)",
    [ownerCode, ownerId, await hashCredential(ownerPassword), await hashCredential(pin)]);
    ownerStaffId = Number(createdOwner.insertId);
    await db.execute("INSERT INTO admin_security_owners (staff_id,credential_state) " +
      "VALUES (?,'SETUP_PENDING')", [ownerStaffId]);
    const [createdEmployee] = await db.execute("INSERT INTO staff " +
      "(staff_code,name,admin_login_id,security_password_hash,employee_pin_hash,role,is_active," +
      "pos_enabled,admin_enabled,kds_enabled,kds_pin_change_required) " +
      "VALUES (?,'Lifecycle Employee',?, ?,?,'STAFF',1,1,1,1,0)",
    [employeeCode, employeeId, await hashCredential(employeePassword), await hashCredential(pin)]);
    employeeStaffId = Number(createdEmployee.insertId);

    const ownerTrust = await request("/api/admin-center/trust", "POST",
      { loginId: ownerId, password: ownerPassword });
    expect(ownerTrust, 200, "owner trust");
    const ownerLogin = await request("/api/admin-center/login", "POST",
      { loginId: ownerId, pin }, ownerTrust.cookie);
    expect(ownerLogin, 200, "owner PIN login");
    const ownerCookie = `${ownerTrust.cookie}; ${ownerLogin.cookie}`;
    const draft = (isActive, posEnabled, kdsEnabled, adminEnabled) => ({
      name: "Lifecycle Employee", loginId: employeeId, role: "STAFF", isActive,
      posEnabled, kdsEnabled, adminEnabled, hosEnabled: false,
      employeePin: "", employeePinConfirm: "",
    });
    const staffPath = `/api/admin-center/staff/${employeeStaffId}`;
    expect(await request(staffPath, "PATCH", draft(true, true, false, true), ownerCookie),
      428, "staff edit without owner second factor");
    expect(await request("/api/admin-center/security/owner-password", "POST",
      { action: "setup", password: ownerFactor, confirm: ownerFactor }, ownerCookie),
    200, "owner second factor setup");

    const credentials = new Map();
    for (const program of programs) {
      const trust = await request(program.trust, "POST",
        { loginId: employeeId, password: employeePassword });
      expect(trust, 200, `${program.name} trust`);
      const login = await request(program.login, "POST", { loginId: employeeId, pin }, trust.cookie);
      expect(login, 200, `${program.name} PIN login`);
      credentials.set(program.name, { trust: trust.cookie, session: login.cookie });
    }

    expect(await request(staffPath, "PATCH", draft(true, true, false, true), ownerCookie),
      200, "KDS permission removal");
    const [afterPermission] = await db.execute("SELECT " +
      "(SELECT COUNT(*) FROM program_trust_tokens WHERE enrolled_by_staff_id=? AND program='KDS' " +
      "AND revoked_at IS NULL) AS kds_tokens, " +
      "(SELECT COUNT(*) FROM staff_sessions WHERE staff_id=? AND session_type='KDS' " +
      "AND status='ACTIVE') AS kds_sessions", [employeeStaffId, employeeStaffId]);
    if (Number(afterPermission[0].kds_tokens) !== 0 || Number(afterPermission[0].kds_sessions) !== 0)
      throw new Error("KDS access survived permission removal");
    for (const program of programs) {
      const status = await request(program.trust, "GET", undefined, credentials.get(program.name).trust);
      if (status.body?.trusted !== (program.name !== "KDS"))
        throw new Error(`${program.name} trust state after KDS permission removal is wrong`);
    }

    expect(await request(staffPath, "PATCH", draft(false, true, false, true), ownerCookie),
      200, "employee deactivation");
    const [afterDisable] = await db.execute("SELECT " +
      "(SELECT COUNT(*) FROM program_trust_tokens WHERE enrolled_by_staff_id=? AND revoked_at IS NULL) " +
      "AS active_tokens, (SELECT COUNT(*) FROM staff_sessions WHERE staff_id=? AND status='ACTIVE') " +
      "AS active_sessions", [employeeStaffId, employeeStaffId]);
    if (Number(afterDisable[0].active_tokens) !== 0 || Number(afterDisable[0].active_sessions) !== 0)
      throw new Error("Employee access survived deactivation");
    for (const program of programs) {
      const credential = credentials.get(program.name);
      const status = await request(program.trust, "GET", undefined, credential.trust);
      if (status.body?.trusted !== false)
        throw new Error(`${program.name} trust survived deactivation`);
      const login = await request(program.login, "POST", { loginId: employeeId, pin }, credential.trust);
      expect(login, 403, `${program.name} login after deactivation`);
    }

    expect(await request(`${staffPath}/terminate`, "POST", {}, ownerCookie),
      200, "employee termination");
    const [terminated] = await db.execute("SELECT terminated_at IS NOT NULL AS done," +
      "is_active,pos_enabled,admin_enabled,kds_enabled FROM staff WHERE staff_id=?", [employeeStaffId]);
    if (!terminated[0]?.done || Number(terminated[0].is_active) !== 0 ||
      Number(terminated[0].pos_enabled) !== 0 || Number(terminated[0].admin_enabled) !== 0 ||
      Number(terminated[0].kds_enabled) !== 0)
      throw new Error("Employee termination left permissions enabled");
    process.stdout.write(JSON.stringify({ db: "TDK_POS_TEST",
      permissionRemoval: "pass", deactivation: "pass", termination: "pass",
      ownerSecondFactorRequired: true }) + "\n");
  } finally {
    const ids = [ownerStaffId, employeeStaffId].filter(Number.isSafeInteger);
    if (ids.length) {
      try {
        await db.beginTransaction();
        for (const id of ids) {
          await db.execute("DELETE FROM kds_login_attempts WHERE staff_id=?", [id]);
          await db.execute("DELETE FROM staff_sessions WHERE staff_id=?", [id]);
          await db.execute("DELETE FROM program_trust_tokens WHERE enrolled_by_staff_id=?", [id]);
          await db.execute("DELETE FROM audit_logs WHERE staff_id=?", [id]);
          await db.execute("DELETE FROM master_password_recovery_grants WHERE staff_id=?", [id]);
          await db.execute("DELETE FROM admin_security_owners WHERE staff_id=?", [id]);
          await db.execute("DELETE FROM staff WHERE staff_id=? AND staff_code=?", [id,
            id === ownerStaffId ? ownerCode : employeeCode]);
        }
        await db.commit();
        process.stdout.write(JSON.stringify({ db: "TDK_POS_TEST", cleanup: "complete" }) + "\n");
      } catch (error) {
        await db.rollback().catch(() => {});
        console.error("Lifecycle fixture cleanup needs review", { code: error.code ?? error.name,
          ownerStaffId, employeeStaffId });
      }
    }
    await db.end();
  }
}
main().catch(error => {
  console.error("Staff access lifecycle integration failed", { code: error.code ?? error.name,
    message: error.message });
  process.exitCode = 1;
});
