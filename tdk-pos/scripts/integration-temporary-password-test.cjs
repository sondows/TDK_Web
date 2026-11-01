/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash, randomBytes, randomInt, scrypt } = require("node:crypto");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

const origin = "http://localhost:3000";
const hash = value => new Promise((resolve, reject) => {
  const salt = randomBytes(16).toString("hex");
  scrypt(value, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
    error ? reject(error) : resolve(`scrypt$16384$8$1$${salt}$${key.toString("hex")}`));
});
const newPin = () => {
  while (true) {
    const value = String(randomInt(0, 1000000)).padStart(6, "0");
    if (!/^(\d)\1{5}$/.test(value) && !"0123456789".includes(value) &&
      !"9876543210".includes(value) && value.slice(0, 3) !== value.slice(3)) return value;
  }
};
async function request(path, body, cookie = "") {
  const response = await fetch(origin + path, { method: "POST",
    headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body) });
  return { status: response.status, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    body: await response.json().catch(() => null) };
}
function expect(result, status, label) {
  if (result.status !== status) throw new Error(`${label}: expected HTTP ${status}, got ${result.status}`);
}

async function main() {
  if (process.env.DB_NAME !== "TDK_POS_TEST") throw new Error("Only TDK_POS_TEST is allowed");
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const suffix = randomBytes(6).toString("hex");
  const loginId = `tempe${suffix}`, ownerLoginId = `tempo${suffix}`;
  const ownerCode = `TEMP-O-${suffix}`;
  const ownerMasterPassword = `OM1#${randomBytes(18).toString("base64url")}`;
  const ownerNextMasterPassword = `ON3#${randomBytes(18).toString("base64url")}`;
  const legacyOwnerPassword = `OL2#${randomBytes(18).toString("base64url")}`;
  const ownerPin = String(randomInt(100000, 999999));
  const newPassword = `N2#${randomBytes(18).toString("base64url")}`;
  const pin = newPin();
  let staffId = null, ownerId = null;
  try {
    const [columns] = await db.execute("SELECT COUNT(*) AS n FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='staff' AND COLUMN_NAME='security_password_change_required'");
    if (Number(columns[0].n) !== 1) throw new Error("Apply the TEST temporary password migration first");
    const [createdOwner] = await db.execute("INSERT INTO staff (staff_code,name,admin_login_id,employee_pin_hash," +
      "security_password_hash,security_password_change_required,pos_enabled,kds_enabled,admin_enabled,is_active,role,kds_pin_change_required) " +
      "VALUES (?,'Temporary Password Test Owner',?,?,?,0,0,0,1,1,'OWNER',0)",
    [ownerCode, ownerLoginId, await hash(ownerPin), await hash(ownerMasterPassword)]);
    ownerId = Number(createdOwner.insertId);
    const legacyOwnerHash = await hash(legacyOwnerPassword);
    await db.execute("INSERT INTO admin_security_owners (staff_id,password_hash,credential_state) " +
      "VALUES (?,?,'ACTIVE')", [ownerId, legacyOwnerHash]);
    const ownerTrust = randomBytes(32).toString("base64url");
    const [insertedToken] = await db.execute("INSERT INTO program_trust_tokens " +
      "(program,token_hash,enrolled_by_staff_id) VALUES ('ADM',?,?)",
    [createHash("sha256").update(ownerTrust).digest("hex"), ownerId]);
    const ownerSession = `admin.${randomBytes(32).toString("base64url")}`;
    await db.execute("INSERT INTO staff_sessions (staff_id,trust_token_id,session_token_hash,session_type,status,owner_reauthenticated_at) " +
      "VALUES (?,?,?,'ADMIN','ACTIVE',NOW())",
    [ownerId, Number(insertedToken.insertId), createHash("sha256").update(ownerSession).digest("hex")]);
    const ownerCookies = `tdk_admin_session=${ownerSession}; tdk_adm_trust_${insertedToken.insertId}=${ownerTrust}`;
    const ownerEnrollment = await request("/api/admin-center/trust", {
      loginId: ownerLoginId, password: ownerMasterPassword,
    });
    expect(ownerEnrollment, 200, "owner ADM master-password authentication");
    if (!ownerEnrollment.cookie || ownerEnrollment.body?.pinSetupRequired !== false)
      throw new Error("Owner master authentication did not retain the existing PIN state");
    expect(await request("/api/admin-center/security/owner-password", {
      action: "verify", password: legacyOwnerPassword,
    }, ownerCookies), 401, "legacy owner password rejected");
    expect(await request("/api/admin-center/security/owner-password", {
      action: "verify", password: ownerMasterPassword,
    }, ownerCookies), 200, "employee master password accepted for owner reauthentication");
    const ownerList = await fetch(origin + "/api/admin-center/security/owners", { headers: { cookie: ownerCookies } });
    expect({ status: ownerList.status }, 200, "master-authenticated owner management");
    const tokenList = await fetch(origin + "/api/admin-center/security/trust-tokens", { headers: { cookie: ownerCookies } });
    expect({ status: tokenList.status }, 200, "master-authenticated trust-token management");
    const [legacyAfterVerification] = await db.execute(
      "SELECT password_hash FROM admin_security_owners WHERE staff_id=?", [ownerId]);
    if (legacyAfterVerification.length !== 1 || legacyAfterVerification[0].password_hash !== legacyOwnerHash)
      throw new Error("Owner verification modified the preserved legacy hash");
    const [ownerCredentialBeforeChange] = await db.execute(
      "SELECT employee_pin_hash, security_password_hash FROM staff WHERE staff_id=?", [ownerId]);
    const [ownerTokenCountBeforeChange] = await db.execute(
      "SELECT COUNT(*) AS count FROM program_trust_tokens WHERE enrolled_by_staff_id=? AND revoked_at IS NULL", [ownerId]);
    expect(await request("/api/admin-center/security/owner-password", {
      action: "change", oldPassword: ownerMasterPassword, newPassword: ownerNextMasterPassword,
      confirm: ownerNextMasterPassword,
    }, ownerCookies), 200, "owner changes the shared master password");
    const [ownerCredentialAfterChange] = await db.execute(
      "SELECT employee_pin_hash, security_password_hash FROM staff WHERE staff_id=?", [ownerId]);
    const [ownerTokenCountAfterChange] = await db.execute(
      "SELECT COUNT(*) AS count FROM program_trust_tokens WHERE enrolled_by_staff_id=? AND revoked_at IS NULL", [ownerId]);
    if (ownerCredentialAfterChange[0].employee_pin_hash !== ownerCredentialBeforeChange[0].employee_pin_hash ||
      Number(ownerTokenCountAfterChange[0].count) !== Number(ownerTokenCountBeforeChange[0].count))
      throw new Error("Master-password change modified the existing PIN or trust tokens");
    expect(await request("/api/admin-center/security/owner-password", {
      action: "verify", password: ownerNextMasterPassword,
    }, ownerCookies), 200, "changed master password reauthenticates");
    const oldOwnerLogin = await request("/api/admin-center/trust", {
      loginId: ownerLoginId, password: ownerMasterPassword,
    });
    expect(oldOwnerLogin, 401, "old master password rejected after change");
    const changedOwnerLogin = await request("/api/admin-center/trust", {
      loginId: ownerLoginId, password: ownerNextMasterPassword,
    });
    expect(changedOwnerLogin, 200, "new master password used for ADM trust authentication");
    const created = await request("/api/admin-center/staff", {
      name: "Temporary Password Test", loginId, role: "STAFF", isActive: true,
      posEnabled: false, kdsEnabled: false, hosEnabled: false, adminEnabled: true,
      employeePin: "", employeePinConfirm: "",
    }, ownerCookies);
    expect(created, 201, "owner creates new employee");
    staffId = Number(created.body?.staffId);
    expect(await request(`/api/admin-center/staff/${ownerId}/security-password`, {}, ownerCookies),
      403, "owner password cannot be replaced through staff management");
    const temporaryPassword = created.body?.temporaryPassword;
    if (!Number.isSafeInteger(staffId) || typeof temporaryPassword !== "string" || temporaryPassword.length < 10)
      throw new Error("Admin staff creation did not return a temporary password");
    const first = await request("/api/admin-center/trust", { loginId, password: temporaryPassword });
    expect(first, 200, "temporary password verification");
    if (first.body?.passwordChangeRequired !== true || first.cookie)
      throw new Error("Temporary password incorrectly issued a long-term trust token");
    expect(await request("/api/program-trust/change-temporary-password", {
      program: "ADM", loginId, temporaryPassword: "incorrect-password",
      newPassword, confirmPassword: newPassword,
    }), 401, "wrong temporary password");
    const changed = await request("/api/program-trust/change-temporary-password", {
      program: "ADM", loginId, temporaryPassword, newPassword, confirmPassword: newPassword,
    });
    expect(changed, 200, "temporary password replacement");
    if (changed.cookie) throw new Error("Password replacement issued a trust cookie");
    expect(await request("/api/program-trust/change-temporary-password", {
      program: "ADM", loginId, temporaryPassword, newPassword, confirmPassword: newPassword,
    }), 401, "reused temporary password");
    expect(await request("/api/admin-center/trust", { loginId, password: temporaryPassword }),
      401, "old password after replacement");
    const trust = await request("/api/admin-center/trust", { loginId, password: newPassword });
    expect(trust, 200, "new password first authentication");
    if (!trust.cookie || trust.body?.pinSetupRequired !== true) throw new Error("Trust or PIN setup missing");
    const setup = await request("/api/program-trust/pin", { program: "ADM", loginId,
      pin, confirmPin: pin }, trust.cookie);
    expect(setup, 200, "first personal PIN registration");
    if (!setup.cookie.startsWith("tdk_admin_session=") || setup.body?.sessionCreated !== true)
      throw new Error("PIN registration did not create a session");
    const bothCookies = `${trust.cookie}; ${setup.cookie}`;
    const page = await fetch(origin + "/tdkadm", { headers: { cookie: bothCookies }, redirect: "manual" });
    if (page.status !== 200) throw new Error(`ADM home after first PIN: HTTP ${page.status}`);
    expect(await request("/api/admin-center/logout", {}, bothCookies), 200, "ADM logout");
    const later = await request("/api/admin-center/login", { loginId, pin }, trust.cookie);
    expect(later, 200, "PIN login with existing program trust");
    const nonOwnerAccess = await fetch(origin + "/api/admin-center/security/owners", {
      headers: { cookie: `${trust.cookie}; ${later.cookie}` },
    });
    expect({ status: nonOwnerAccess.status }, 403, "regular ADM employee blocked from owner management");
    const reset = await request(`/api/admin-center/staff/${staffId}/security-password`, {}, ownerCookies);
    expect(reset, 200, "owner issues a replacement temporary password");
    if (typeof reset.body?.temporaryPassword !== "string")
      throw new Error("Password reset did not return a one-time temporary password");
    const oldTrust = await fetch(origin + "/api/admin-center/trust", { headers: { cookie: trust.cookie } });
    if ((await oldTrust.json()).trusted !== false) throw new Error("Password reset retained old trust");
    const replacement = await request("/api/admin-center/trust", {
      loginId, password: reset.body.temporaryPassword,
    });
    expect(replacement, 200, "existing employee temporary password");
    if (replacement.body?.passwordChangeRequired !== true || replacement.cookie)
      throw new Error("Existing employee reset bypassed password replacement");
    await db.execute("UPDATE staff SET is_active=0,terminated_at=NOW() WHERE staff_id=?", [staffId]);
    const revoked = await fetch(origin + "/api/admin-center/trust", { headers: { cookie: trust.cookie } });
    if ((await revoked.json()).trusted !== false) throw new Error("Terminated employee retained program trust");
    const blocked = await fetch(origin + "/tdkadm", {
      headers: { cookie: `${trust.cookie}; ${later.cookie}` }, redirect: "manual",
    });
    if (blocked.status !== 307 && blocked.status !== 308)
      throw new Error(`Terminated employee retained ADM access: HTTP ${blocked.status}`);
    process.stdout.write(JSON.stringify({ db: "TDK_POS_TEST", ownerMasterLogin: ownerEnrollment.status,
      ownerPasswordChange: 200, changedMasterForAdm: changedOwnerLogin.status, pinAndTrustPreserved: true,
      ownerLegacyRejected: 401,
      ownerMasterAccepted: 200, ownerManagement: ownerList.status, trustTokenManagement: tokenList.status,
      nonOwnerManagement: nonOwnerAccess.status, temporaryPassword: first.status,
      change: changed.status, trust: trust.status, pinSetup: setup.status, home: page.status,
      pinReentry: later.status, ownerReset: reset.status, terminated: blocked.status }) + "\n");
  } finally {
    if (staffId || ownerId) {
      try {
        await db.beginTransaction();
        for (const id of [staffId, ownerId].filter(Boolean)) {
          await db.execute("DELETE FROM admin_security_owners WHERE staff_id=?", [id]);
          await db.execute("DELETE FROM kds_login_attempts WHERE staff_id=?", [id]);
          await db.execute("DELETE FROM staff_sessions WHERE staff_id=?", [id]);
          await db.execute("DELETE FROM audit_logs WHERE staff_id=?", [id]);
          await db.execute("DELETE FROM program_trust_tokens WHERE enrolled_by_staff_id=?", [id]);
          await db.execute("DELETE FROM staff WHERE staff_id=?", [id]);
        }
        for (const scope of ["trust-enroll-adm", "temporary-password-change", "employee-pin-setup",
          "adm-login", "owner-security", "owner-security-change"]) {
          for (const account of [loginId, ownerLoginId]) {
            const key = createHash("sha256").update(`${scope}:account:${account}`).digest("hex");
            await db.execute("DELETE FROM admin_auth_attempts WHERE attempt_key=?", [key]);
          }
        }
        await db.commit();
        process.stdout.write(JSON.stringify({ db: "TDK_POS_TEST", cleanup: "complete" }) + "\n");
      } catch (error) {
        await db.rollback().catch(() => {});
        console.error("Temporary fixture cleanup needs review", { code: error.code ?? error.name, staffId, ownerId });
      }
    }
    await db.end();
  }
}
main().catch(error => { console.error("Temporary password integration failed", {
  code: error.code ?? error.name, message: error.message,
}); process.exitCode = 1; });
