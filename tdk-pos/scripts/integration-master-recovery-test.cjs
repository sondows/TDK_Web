/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash, randomBytes, randomInt } = require("node:crypto");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

const origin = "http://localhost:3000";
const digest = value => createHash("sha256").update(value).digest("hex");
const newPassword = () => `M9!${randomBytes(20).toString("base64url")}`;
const newPin = () => {
  while (true) {
    const pin = String(randomInt(0, 1000000)).padStart(6, "0");
    if (!/^(\d)\1{5}$/.test(pin) && !"0123456789".includes(pin) &&
      !"9876543210".includes(pin) && pin.slice(0, 3) !== pin.slice(3)) return pin;
  }
};
async function post(path, body, cookie = "") {
  const response = await fetch(origin + path, {
    method: "POST", headers: { origin, "content-type": "application/json",
      ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null),
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    setCookie: response.headers.get("set-cookie") ?? "" };
}
function expect(response, status, label) {
  if (response.status !== status) throw new Error(`${label}: expected ${status}, received ${response.status}`);
}

async function main() {
  if (process.env.DB_NAME !== "TDK_POS_TEST") throw new Error("Only TDK_POS_TEST is allowed");
  const db = await mysql.createConnection({ host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const suffix = randomBytes(6).toString("hex");
  const loginId = `master${suffix}`, staffCode = `MASTER-${suffix}`;
  const pin = newPin(), password = newPassword(), replacement = newPassword();
  const attemptKey = digest(`trust-enroll-adm:account:${loginId}`);
  const statusLimitKey = digest("master-recovery-status:ip:unverified");
  let staffId = null;
  let originalLimit;
  try {
    const [limitRows] = await db.execute("SELECT attempt_count, " +
      "DATE_FORMAT(window_started_at,'%Y-%m-%d %H:%i:%s') AS started_at, " +
      "DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s') AS updated_at " +
      "FROM admin_auth_attempts WHERE attempt_key=?", [statusLimitKey]);
    originalLimit = limitRows[0] ?? null;
    await db.execute("DELETE FROM admin_auth_attempts WHERE attempt_key=?", [statusLimitKey]);
    const [created] = await db.execute("INSERT INTO staff " +
      "(staff_code,name,admin_login_id,role,is_active,admin_enabled,kds_pin_change_required) " +
      "VALUES (?,'Master Recovery Test',?,'OWNER',1,1,0)", [staffCode, loginId]);
    staffId = Number(created.insertId);
    await db.execute("INSERT INTO admin_security_owners (staff_id,credential_state) VALUES (?,'SETUP_PENDING')",
      [staffId]);
    await db.execute("INSERT INTO admin_auth_attempts " +
      "(attempt_key,window_started_at,attempt_count) VALUES (?,NOW(),5)", [attemptKey]);
    const token = randomBytes(32).toString("base64url");
    await db.execute("INSERT INTO master_password_recovery_grants (staff_id,token_hash,expires_at) " +
      "VALUES (?,?,DATE_ADD(NOW(),INTERVAL 15 MINUTE))", [staffId, digest(token)]);
    const statusPath = "/api/program-trust/master-recovery/status";
    const registerPath = "/api/program-trust/master-recovery/register";
    const authPath = "/api/admin-center/trust";
    expect(await post(authPath, { loginId, password }), 429, "pre-recovery lock");
    const invalidStatus = await post(statusPath, { loginId, token: "X".repeat(43) });
    expect(invalidStatus, 200, "invalid recovery status");
    if (invalidStatus.body?.available !== false) throw new Error("Invalid grant exposed registration");
    const wrongId = await post(statusPath, { loginId: `other${suffix}`, token });
    expect(wrongId, 200, "wrong ID recovery status");
    if (wrongId.body?.available !== false) throw new Error("Grant crossed to another ID");
    const expiredToken = randomBytes(32).toString("base64url");
    await db.execute("INSERT INTO master_password_recovery_grants (staff_id,token_hash,expires_at) " +
      "VALUES (?,?,DATE_SUB(NOW(),INTERVAL 1 MINUTE))", [staffId, digest(expiredToken)]);
    const expiredStatus = await post(statusPath, { loginId, token: expiredToken });
    expect(expiredStatus, 200, "expired recovery status");
    if (expiredStatus.body?.available !== false) {
      const [clock] = await db.execute("SELECT expires_at<NOW() AS db_expired, " +
        "expires_at<UTC_TIMESTAMP() AS utc_expired FROM master_password_recovery_grants WHERE token_hash=?",
      [digest(expiredToken)]);
      throw new Error(`Expired grant status=${expiredStatus.status} available=${expiredStatus.body?.available} ` +
        `dbExpired=${clock[0]?.db_expired} utcExpired=${clock[0]?.utc_expired}`);
    }
    expect(await post(registerPath, { loginId, token: expiredToken, password,
      confirmPassword: password }), 401, "expired recovery token");
    const status = await post(statusPath, { token });
    expect(status, 200, "valid recovery status");
    if (status.body?.available !== true || status.body?.registrationKind !== "first" ||
      status.body?.passwordConfigured !== false || status.body?.loginId !== loginId)
      throw new Error("Unregistered master password state not recognized");
    if (!status.cookie.startsWith("tdk_adm_master_recovery="))
      throw new Error("Recovery status did not persist its short-lived browser credential");
    if (!status.setCookie.includes("HttpOnly") || !status.setCookie.includes("SameSite=strict") ||
      !status.setCookie.includes("Path=/api/program-trust/master-recovery"))
      throw new Error("Recovery cookie security attributes are missing");
    const refreshed = await post(statusPath, {}, status.cookie);
    if (refreshed.body?.available !== true || refreshed.body?.registrationKind !== "first" ||
      refreshed.body?.loginId !== loginId)
      throw new Error("Recovery button state did not survive a page refresh");
    const denied = await post(registerPath, { loginId, token: "X".repeat(43),
      password, confirmPassword: password });
    expect(denied, 401, "invalid recovery token");
    expect(await post(registerPath, { loginId, token, password: "weak",
      confirmPassword: "weak" }), 400, "weak password");
    const [beforeRegistration] = await db.execute(
      "SELECT security_password_hash IS NULL AS hash_absent FROM staff WHERE staff_id=?", [staffId]);
    if (!beforeRegistration[0]?.hash_absent)
      throw new Error("Rejected recovery changed the master password");
    const registered = await post(registerPath, { loginId, password, confirmPassword: password }, status.cookie);
    expect(registered, 200, "first master password registration");
    if (!registered.setCookie.includes("Max-Age=0"))
      throw new Error("Consumed recovery credential was not removed from the browser");
    const [flags] = await db.execute("SELECT security_password_hash IS NOT NULL AS has_hash, " +
      "LEFT(security_password_hash,7) AS hash_prefix, employee_pin_hash IS NULL AS no_pin " +
      "FROM staff WHERE staff_id=?", [staffId]);
    if (!flags[0].has_hash || flags[0].hash_prefix !== "scrypt$" || !flags[0].no_pin)
      throw new Error("Recovery changed unexpected employee credential state");
    const [usedGrants] = await db.execute("SELECT COUNT(*) AS count FROM master_password_recovery_grants " +
      "WHERE staff_id=? AND token_hash=? AND used_at IS NOT NULL", [staffId, digest(token)]);
    if (Number(usedGrants[0].count) !== 1) throw new Error("Recovery grant was not consumed");
    const [lock] = await db.execute("SELECT COUNT(*) AS count FROM admin_auth_attempts WHERE attempt_key=?",
      [attemptKey]);
    if (Number(lock[0].count) !== 0) throw new Error("Master password lock was not cleared");
    const consumed = await post(statusPath, { loginId, token });
    if (consumed.body?.available !== false) throw new Error("Recovery grant remained active");
    expect(await post(registerPath, { loginId, token, password, confirmPassword: password }),
      401, "reused recovery token");
    const wrongPassword = newPassword();
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(await post(authPath, { loginId, password: wrongPassword }),
        attempt === 5 ? 429 : 401, `wrong master password attempt ${attempt}`);
    }
    expect(await post(authPath, { loginId, password }), 429, "master password lock after five failures");
    const [failedAttempts] = await db.execute("SELECT attempt_count, " +
      "window_started_at>DATE_SUB(NOW(),INTERVAL 15 MINUTE) AS recent " +
      "FROM admin_auth_attempts WHERE attempt_key=?", [attemptKey]);
    if (Number(failedAttempts[0]?.attempt_count) !== 5 || !failedAttempts[0]?.recent)
      throw new Error("Master password failure window was not stored correctly");
    await db.execute("DELETE FROM admin_auth_attempts WHERE attempt_key=?", [attemptKey]);
    const trust = await post(authPath, { loginId, password });
    expect(trust, 200, "new master password authentication");
    if (!trust.cookie || trust.body?.pinSetupRequired !== true)
      throw new Error("First authentication did not issue ADM trust and request PIN setup");
    const setup = await post("/api/program-trust/pin", { program: "ADM", loginId,
      pin, confirmPin: pin }, trust.cookie);
    expect(setup, 200, "personal PIN registration");
    if (!setup.cookie || setup.body?.sessionCreated !== true)
      throw new Error("PIN registration did not create an ADM session");
    const home = await fetch(origin + "/tdkadm", { headers: { cookie: `${trust.cookie}; ${setup.cookie}` },
      redirect: "manual" });
    expect(home, 200, "ADM home");
    expect(await post("/api/admin-center/logout", {}, `${trust.cookie}; ${setup.cookie}`),
      200, "ADM logout");
    expect(await post("/api/admin-center/login", { loginId, pin }, trust.cookie), 200,
      "later PIN login");

    const nextToken = randomBytes(32).toString("base64url");
    await db.execute("INSERT INTO master_password_recovery_grants (staff_id,token_hash,expires_at) " +
      "VALUES (?,?,DATE_ADD(NOW(),INTERVAL 15 MINUTE))", [staffId, digest(nextToken)]);
    await db.execute("INSERT INTO admin_auth_attempts " +
      "(attempt_key,window_started_at,attempt_count) VALUES (?,NOW(),5)", [attemptKey]);
    const resetStatus = await post(statusPath, { loginId, token: nextToken });
    if (resetStatus.body?.available !== true || resetStatus.body?.registrationKind !== "reset")
      throw new Error("Existing master password recovery state not recognized");
    expect(await post(registerPath, { loginId,
      password: replacement, confirmPassword: replacement }, resetStatus.cookie), 200, "existing hash recovery");
    const [remainingAccess] = await db.execute(
      "SELECT (SELECT COUNT(*) FROM program_trust_tokens WHERE enrolled_by_staff_id=? AND revoked_at IS NULL) " +
      "AS active_tokens, (SELECT COUNT(*) FROM staff_sessions WHERE staff_id=? AND status='ACTIVE') " +
      "AS active_sessions", [staffId, staffId]);
    if (Number(remainingAccess[0].active_tokens) !== 0 || Number(remainingAccess[0].active_sessions) !== 0)
      throw new Error("Old trust or employee session survived master password recovery");
    const previous = await fetch(origin + authPath, { headers: { cookie: trust.cookie } });
    if ((await previous.json()).trusted !== false) throw new Error("Old ADM trust survived password reset");
    expect(await post(authPath, { loginId, password }), 401, "old master password");
    const renewed = await post(authPath, { loginId, password: replacement });
    expect(renewed, 200, "replacement master password");
    if (renewed.body?.pinSetupRequired !== false) throw new Error("Existing PIN was lost");
    expect(await post("/api/admin-center/login", { loginId, pin }, renewed.cookie),
      200, "PIN after master password reset");
    process.stdout.write(JSON.stringify({ db: "TDK_POS_TEST", status: status.status,
      registration: registered.status, trust: trust.status, pin: setup.status, home: home.status,
      reset: renewed.status, lockCleared: true }) + "\n");
  } finally {
    if (staffId !== null) {
      try {
        await db.beginTransaction();
        await db.execute("DELETE FROM kds_login_attempts WHERE staff_id=?", [staffId]);
        await db.execute("DELETE FROM staff_sessions WHERE staff_id=?", [staffId]);
        await db.execute("DELETE FROM program_trust_tokens WHERE enrolled_by_staff_id=?", [staffId]);
        await db.execute("DELETE FROM audit_logs WHERE staff_id=?", [staffId]);
        await db.execute("DELETE FROM master_password_recovery_grants WHERE staff_id=?", [staffId]);
        await db.execute("DELETE FROM admin_security_owners WHERE staff_id=?", [staffId]);
        await db.execute("DELETE FROM staff WHERE staff_id=? AND staff_code=?", [staffId, staffCode]);
        await db.execute("DELETE FROM admin_auth_attempts WHERE attempt_key=?", [attemptKey]);
        await db.commit();
        process.stdout.write(JSON.stringify({ db: "TDK_POS_TEST", cleanup: "complete" }) + "\n");
      } catch (error) {
        await db.rollback().catch(() => {});
        console.error("Recovery fixture cleanup needs review", { code: error.code ?? error.name, staffId });
      }
    }
    if (originalLimit !== undefined) {
      await db.execute("DELETE FROM admin_auth_attempts WHERE attempt_key=?", [statusLimitKey]);
      if (originalLimit) await db.execute("INSERT INTO admin_auth_attempts " +
        "(attempt_key,window_started_at,attempt_count,updated_at) VALUES (?,?,?,?)",
      [statusLimitKey, originalLimit.started_at, originalLimit.attempt_count, originalLimit.updated_at]);
    }
    await db.end();
  }
}
main().catch(error => {
  console.error("Master recovery integration failed", { code: error.code ?? error.name, message: error.message });
  process.exitCode = 1;
});
