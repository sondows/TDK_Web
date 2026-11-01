/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash, randomBytes, randomInt, scrypt } = require("node:crypto");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

const origin = "http://localhost:3000";
const programs = [
  { name: "POS", trust: "/api/auth/trust", login: "/api/auth/login",
    logout: "/api/auth/logout", page: "/tdkpos" },
  { name: "ADM", trust: "/api/admin-center/trust", login: "/api/admin-center/login",
    logout: "/api/admin-center/logout", page: "/tdkadm" },
  { name: "KDS", trust: "/api/kitchen/auth/trust", login: "/api/kitchen/auth/login",
    logout: "/api/kitchen/auth/logout", page: "/tdkkds" },
];
const requestedPrograms = process.env.TEST_PROGRAMS?.split(",").map(value => value.trim()).filter(Boolean);
const selectedPrograms = requestedPrograms?.length ?
  programs.filter(program => requestedPrograms.includes(program.name)) : programs;
if (requestedPrograms?.length && selectedPrograms.length !== requestedPrograms.length)
  throw new Error("TEST_PROGRAMS must contain only POS, ADM, KDS");
const initialPin = process.env.TEST_INITIAL_PIN === "1";
const expiredPinWindow = process.env.TEST_EXPIRED_PIN_WINDOW === "1";
if (initialPin && selectedPrograms.length !== 1)
  throw new Error("TEST_INITIAL_PIN requires exactly one selected program");
if (expiredPinWindow && !initialPin)
  throw new Error("TEST_EXPIRED_PIN_WINDOW requires TEST_INITIAL_PIN=1");

function hashCredential(value) {
  const salt = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    scrypt(value, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(`scrypt$16384$8$1$${salt}$${key.toString("hex")}`);
    });
  });
}
function newPin() {
  while (true) {
    const value = String(randomInt(0, 1000000)).padStart(6, "0");
    if (!/^(\d)\1{5}$/.test(value) && !"0123456789".includes(value) &&
      !"9876543210".includes(value) && value.slice(0, 3) !== value.slice(3)) return value;
  }
}

async function request(path, method = "GET", body, cookie = "") {
  const response = await fetch(origin + path, {
    method, redirect: "follow",
    headers: { origin, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = response.headers.get("set-cookie") ?? "";
  return { status: response.status, path: new URL(response.url).pathname,
    cookie: setCookie.split(";")[0] ?? "",
    cookieFlags: { httpOnly: /;\s*httponly(?:;|$)/i.test(setCookie),
      secure: /;\s*secure(?:;|$)/i.test(setCookie),
      sameSiteStrict: /;\s*samesite=strict(?:;|$)/i.test(setCookie) },
    body: await response.json().catch(() => null) };
}

function expect(result, status, label) {
  if (result.status !== status) throw new Error(`${label}: expected HTTP ${status}, received ${result.status}`);
}

async function main() {
  if (process.env.DB_NAME !== "TDK_POS_TEST") throw new Error("Only TDK_POS_TEST is allowed");
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  let staffId = null;
  const results = [];
  const suffix = randomBytes(6).toString("hex");
  const loginId = `intg${suffix}`;
  const staffCode = `INTG-${suffix.toUpperCase()}`;
  const password = `T9#${randomBytes(18).toString("base64url")}`;
  const pin = newPin();
  try {
    const [schema] = await connection.query(
      "SELECT COUNT(*) AS ready FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='staff' AND COLUMN_NAME IN " +
      "('employee_pin_hash','security_password_hash','pos_enabled','kds_enabled','admin_enabled')");
    if (Number(schema[0].ready) !== 5) throw new Error("Test staff schema is incomplete");
    const [created] = await connection.execute(
      "INSERT INTO staff (staff_code, name, admin_login_id, employee_pin_hash, security_password_hash, " +
      "pos_enabled, kds_enabled, admin_enabled, is_active, role, kds_pin_change_required) " +
      "VALUES (?, 'Authentication Integration Test', ?, ?, ?, 1, 1, 1, 1, 'STAFF', 0)",
      [staffCode, loginId, initialPin ? null : await hashCredential(pin), await hashCredential(password)]);
    staffId = Number(created.insertId);

    if (selectedPrograms.some(program => program.name === "POS")) {
      const available = await request(`/api/auth/trust?loginId=${encodeURIComponent(loginId)}`);
      expect(available, 200, "POS ID status for an eligible employee");
      if (available.body?.success !== true || available.body?.trusted !== false ||
        available.body?.masterPasswordConfigured !== true)
        throw new Error("POS ID status did not return the eligible employee's master-password state");
      const unknown = await request(`/api/auth/trust?loginId=missing${suffix}`);
      expect(unknown, 403, "POS ID status for an unknown employee");
      if (unknown.body?.trusted !== false) throw new Error("POS ID status accepted an unknown employee");
      const noTrustLogin = await request("/api/auth/login", "POST", { loginId, pin });
      expect(noTrustLogin, 403, "POS PIN login without a POS trust token");
      if (noTrustLogin.cookie) throw new Error("POS PIN login bypassed the required POS trust token");

      for (const [label, update] of [
        ["inactive", "UPDATE staff SET is_active=0 WHERE staff_id=?"],
        ["terminated", "UPDATE staff SET terminated_at=NOW() WHERE staff_id=?"],
        ["POS-disabled", "UPDATE staff SET pos_enabled=0 WHERE staff_id=?"],
      ]) {
        await connection.execute(update, [staffId]);
        const denied = await request(`/api/auth/trust?loginId=${encodeURIComponent(loginId)}`);
        expect(denied, 403, `POS ID status for ${label} employee`);
        const noEnrollment = await request("/api/auth/trust", "POST", { loginId, password });
        expect(noEnrollment, 401, `POS token enrollment for ${label} employee`);
        if (noEnrollment.cookie) throw new Error(`${label} employee received a POS token`);
        await connection.execute("UPDATE staff SET is_active=1,terminated_at=NULL,pos_enabled=1 WHERE staff_id=?", [staffId]);
      }
    }

    if (selectedPrograms.some(program => program.name === "KDS")) {
      const available = await request(`/api/kitchen/auth/trust?loginId=${encodeURIComponent(loginId)}`);
      expect(available, 200, "KDS ID status for an eligible employee");
      if (available.body?.success !== true || available.body?.trusted !== false)
        throw new Error("KDS ID status did not advance an eligible employee without an existing token");
      const unknown = await request(`/api/kitchen/auth/trust?loginId=missing${suffix}`);
      expect(unknown, 403, "KDS ID status for an unknown employee");
      if (unknown.body?.trusted !== false) throw new Error("KDS ID status accepted an unknown employee");

      for (const [label, update] of [
        ["inactive", "UPDATE staff SET is_active=0 WHERE staff_id=?"],
        ["terminated", "UPDATE staff SET terminated_at=NOW() WHERE staff_id=?"],
        ["KDS-disabled", "UPDATE staff SET kds_enabled=0 WHERE staff_id=?"],
      ]) {
        await connection.execute(update, [staffId]);
        const denied = await request(`/api/kitchen/auth/trust?loginId=${encodeURIComponent(loginId)}`);
        expect(denied, 403, `KDS ID status for ${label} employee`);
        const noEnrollment = await request("/api/kitchen/auth/trust", "POST", { loginId, password });
        expect(noEnrollment, 401, `KDS token enrollment for ${label} employee`);
        if (noEnrollment.cookie) throw new Error(`${label} employee received a KDS token`);
        await connection.execute("UPDATE staff SET is_active=1,terminated_at=NULL,kds_enabled=1 WHERE staff_id=?", [staffId]);
      }
    }

    for (const program of selectedPrograms) {
      const wrongPassword = await request(program.trust, "POST", { loginId, password: password + "!" });
      expect(wrongPassword, 401, `${program.name} wrong password`);
      if (wrongPassword.cookie) throw new Error(`${program.name} issued a cookie for a wrong password`);
      const enrolled = await request(program.trust, "POST", { loginId, password });
      expect(enrolled, 200, `${program.name} enroll`);
      if (!enrolled.cookie) throw new Error(`${program.name} trust cookie missing`);
      if (!enrolled.cookieFlags.httpOnly || !enrolled.cookieFlags.secure || !enrolled.cookieFlags.sameSiteStrict)
        throw new Error(`${program.name} trust cookie security attributes missing`);
      const rawToken = decodeURIComponent(enrolled.cookie.slice(enrolled.cookie.indexOf("=") + 1));
      const expectedHash = createHash("sha256").update(rawToken).digest("hex");
      const [storedTokens] = await connection.execute("SELECT token_hash FROM program_trust_tokens " +
        "WHERE enrolled_by_staff_id=? AND program=? AND revoked_at IS NULL ORDER BY token_id DESC LIMIT 2",
      [staffId, program.name]);
      if (storedTokens.length !== 1 || storedTokens[0].token_hash !== expectedHash || storedTokens[0].token_hash === rawToken)
        throw new Error(`${program.name} token was not stored as a unique SHA-256 hash`);
      const status = await request(program.trust, "GET", undefined, enrolled.cookie);
      expect(status, 200, `${program.name} trust status`);
      if (status.body?.trusted !== true) throw new Error(`${program.name} trust not active`);
      if (initialPin) {
        if (status.body?.pinSetupRequired !== true)
          throw new Error(`${program.name} did not request first PIN registration`);
        if (expiredPinWindow) {
          const [tokens] = await connection.execute("SELECT token_id FROM program_trust_tokens " +
            "WHERE enrolled_by_staff_id=? AND program=? ORDER BY token_id DESC LIMIT 1",
          [staffId, program.name]);
          await connection.execute("UPDATE program_trust_tokens SET created_at=DATE_SUB(NOW(),INTERVAL 11 MINUTE) " +
            "WHERE token_id=?", [tokens[0].token_id]);
          const staleSetup = await request("/api/program-trust/pin", "POST",
            { program: program.name, loginId, pin, confirmPin: pin }, enrolled.cookie);
          expect(staleSetup, 403, `${program.name} stale first PIN setup`);
          if (staleSetup.body?.code !== "PIN_SETUP_REAUTH_REQUIRED" || staleSetup.cookie)
            throw new Error(`${program.name} stale trust bypassed master password reauthentication`);
        }
        const setup = await request("/api/program-trust/pin", "POST",
          { program: program.name, loginId, pin, confirmPin: pin,
            ...(expiredPinWindow ? { password } : {}) }, enrolled.cookie);
        expect(setup, 200, `${program.name} initial PIN setup`);
        if (!setup.body?.sessionCreated || !setup.cookie)
          throw new Error(`${program.name} first PIN registration did not create a session`);
      }
      for (const other of programs.filter(item => item.name !== program.name)) {
        const crossUse = await request(other.trust, "GET", undefined, enrolled.cookie);
        if (crossUse.body?.trusted !== false) throw new Error(`${program.name} token crossed into ${other.name}`);
      }

      const wrongPin = String((Number(pin) + 1) % 1000000).padStart(6, "0");
      const rejected = await request(program.login, "POST", { loginId, pin: wrongPin }, enrolled.cookie);
      expect(rejected, 401, `${program.name} wrong PIN`);

      const loggedIn = await request(program.login, "POST", { loginId, pin }, enrolled.cookie);
      expect(loggedIn, 200, `${program.name} PIN login`);
      if (!loggedIn.cookie) throw new Error(`${program.name} session cookie missing`);
      const sessionType = program.name === "ADM" ? "ADMIN" : program.name;
      const [activeSessions] = await connection.execute(
        "SELECT COUNT(*) AS count FROM staff_sessions WHERE staff_id=? AND session_type=? " +
        "AND status='ACTIVE' AND trust_token_id IS NOT NULL", [staffId, sessionType]);
      if (Number(activeSessions[0].count) < 1) throw new Error(`${program.name} session missing from DB`);
      const combinedCookie = `${enrolled.cookie}; ${loggedIn.cookie}`;
      const page = await request(program.page, "GET", undefined, combinedCookie);
      expect(page, 200, `${program.name} page`);
      if (page.path.includes("/login")) throw new Error(`${program.name} stayed at login`);
      expect(await request(program.logout, "POST", undefined, combinedCookie),
        200, `${program.name} logout`);
      const afterLogout = await request(program.trust, "GET", undefined, enrolled.cookie);
      if (afterLogout.body?.trusted !== true)
        throw new Error(`${program.name} logout incorrectly revoked program trust`);
      const withoutTrust = await request(program.login, "POST", { loginId, pin });
      expect(withoutTrust, 403, `${program.name} PIN without trust`);
      if (withoutTrust.body?.code !== "TRUST_REQUIRED")
        throw new Error(`${program.name} PIN login did not require program trust`);
      const relogged = await request(program.login, "POST", { loginId, pin }, enrolled.cookie);
      expect(relogged, 200, `${program.name} reconnect PIN login`);
      if (!relogged.cookie) throw new Error(`${program.name} reconnect session cookie missing`);
      const reconnectedCookie = `${enrolled.cookie}; ${relogged.cookie}`;
      const reconnectedPage = await request(program.page, "GET", undefined, reconnectedCookie);
      expect(reconnectedPage, 200, `${program.name} reconnect page`);
      if (reconnectedPage.path.includes("/login"))
        throw new Error(`${program.name} reconnect stayed at login`);
      results.push({ program: program.name, wrongPassword: wrongPassword.status,
        enroll: enrolled.status, wrongPin: rejected.status,
        login: loggedIn.status, reconnect: relogged.status, page: page.status });

      const revoked = await request(program.trust, "DELETE", undefined, enrolled.cookie);
      expect(revoked, 200, `${program.name} revoke`);
      const after = await request(program.trust, "GET", undefined, enrolled.cookie);
      if (after.body?.trusted !== false) throw new Error(`${program.name} revoked token still valid`);
      const [remainingSessions] = await connection.execute(
        "SELECT COUNT(*) AS count FROM staff_sessions WHERE staff_id=? AND session_type=? " +
        "AND status='ACTIVE'", [staffId, sessionType]);
      if (Number(remainingSessions[0].count) !== 0) throw new Error(`${program.name} session survived revocation`);
      if (program.name === "KDS") {
        const blocked = await request("/api/kitchen", "GET", undefined, reconnectedCookie);
        expect(blocked, 401, "KDS work API after revocation");
        for (const path of ["/api/kitchen/tasks/1", "/api/kitchen/tables/1/start",
          "/api/kitchen/tables/1/complete"]) {
          const action = await request(path, "POST", {}, reconnectedCookie);
          expect(action, 401, `KDS action API ${path} after revocation`);
        }
      } else {
        const blocked = await request(program.page, "GET", undefined, reconnectedCookie);
        if (!blocked.path.includes("/login")) throw new Error(`${program.name} page survived revocation`);
      }
      const afterRevokeLogin = await request(program.login, "POST", { loginId, pin }, enrolled.cookie);
      expect(afterRevokeLogin, 403, `${program.name} PIN after trust revocation`);
      if (afterRevokeLogin.body?.code !== "TRUST_REQUIRED")
        throw new Error(`${program.name} revoked trust did not require first authentication`);
    }
    process.stdout.write(JSON.stringify({ db: "TDK_POS_TEST", results, cleanup: "pending" }) + "\n");
  } finally {
    if (staffId !== null) {
      try {
        await connection.beginTransaction();
        await connection.execute("DELETE FROM kds_login_attempts WHERE staff_id=?", [staffId]);
        await connection.execute("DELETE FROM staff_sessions WHERE staff_id=?", [staffId]);
        await connection.execute("DELETE FROM audit_logs WHERE staff_id=?", [staffId]);
        await connection.execute("DELETE FROM program_trust_tokens WHERE enrolled_by_staff_id=?", [staffId]);
        await connection.execute("DELETE FROM staff WHERE staff_id=? AND staff_code=?", [staffId, staffCode]);
        await connection.commit();
        process.stdout.write(JSON.stringify({ db: "TDK_POS_TEST", cleanup: "complete" }) + "\n");
      } catch (error) {
        await connection.rollback().catch(() => {});
        await connection.execute("UPDATE staff SET is_active=0, security_password_hash=NULL, employee_pin_hash=NULL WHERE staff_id=? AND staff_code=?", [staffId, staffCode]).catch(() => {});
        console.error("Integration fixture cleanup needs review", { code: error.code ?? error.name, staffId });
      }
    }
    await connection.end();
  }
}

main().catch(error => {
  console.error("Program trust integration failed", { name: error.name, message: error.message, code: error.code });
  process.exitCode = 1;
});
