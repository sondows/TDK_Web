/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash, randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

const origin = "http://localhost:3000";
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const digest = value => createHash("sha256").update(value).digest("hex");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, label, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await check();
      if (result) return result;
    } catch { /* Navigation can replace the inspected page. */ }
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function startBrowser(profile) {
  const browser = spawn(chromePath, [
    "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  const portFile = path.join(profile, "DevToolsActivePort");
  const port = await until(async () => {
    const content = await fs.readFile(portFile, "utf8");
    return Number(content.split(/\r?\n/)[0]) || null;
  }, "Chrome debugging port");
  const tabs = await until(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const pages = await response.json();
    return pages.find(page => page.type === "page" && page.webSocketDebuggerUrl);
  }, "Chrome page");
  const socket = new WebSocket(tabs.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const resolver = pending.get(message.id);
    if (!resolver) return;
    pending.delete(message.id);
    if (message.error) resolver.reject(new Error(message.error.message));
    else resolver.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error("Browser expression failed");
    return result.result.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  return { browser, socket, send, evaluate };
}

async function main() {
  if (process.env.DB_NAME !== "TDK_POS_TEST") throw new Error("Only TDK_POS_TEST is allowed");
  const db = await mysql.createConnection({ host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const suffix = randomBytes(6).toString("hex");
  const loginId = `view${suffix}`, staffCode = `VIEW-${suffix}`;
  const validToken = randomBytes(32).toString("base64url");
  const expiredToken = randomBytes(32).toString("base64url");
  const statusLimitKey = digest("master-recovery-status:ip:unverified");
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "tdk-adm-recovery-"));
  let staffId = null;
  let chrome = null;
  let originalLimit;
  try {
    const [limitRows] = await db.execute("SELECT attempt_count, " +
      "DATE_FORMAT(window_started_at,'%Y-%m-%d %H:%i:%s') AS started_at, " +
      "DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s') AS updated_at " +
      "FROM admin_auth_attempts WHERE attempt_key=?", [statusLimitKey]);
    originalLimit = limitRows[0] ?? null;
    await db.execute("DELETE FROM admin_auth_attempts WHERE attempt_key=?", [statusLimitKey]);
    const [inserted] = await db.execute("INSERT INTO staff " +
      "(staff_code,name,admin_login_id,role,is_active,admin_enabled,kds_pin_change_required) " +
      "VALUES (?,'Recovery UI Test',?,'OWNER',1,1,0)", [staffCode, loginId]);
    staffId = Number(inserted.insertId);
    await db.execute("INSERT INTO admin_security_owners (staff_id,credential_state) VALUES (?,'SETUP_PENDING')",
      [staffId]);
    await db.execute("INSERT INTO master_password_recovery_grants (staff_id,token_hash,expires_at) " +
      "VALUES (?,?,DATE_ADD(NOW(),INTERVAL 15 MINUTE))", [staffId, digest(validToken)]);
    await db.execute("INSERT INTO master_password_recovery_grants (staff_id,token_hash,expires_at) " +
      "VALUES (?,?,DATE_SUB(NOW(),INTERVAL 1 MINUTE))", [staffId, digest(expiredToken)]);
    chrome = await startBrowser(profile);
    const navigate = async token => {
      await chrome.send("Page.navigate", {
        url: `${origin}/tdkadm/login?recovery=1#master-recovery=${token}`,
      });
    };
    const hasButton = label => chrome.evaluate(
      `Array.from(document.querySelectorAll("button")).some(button => button.textContent?.trim() === ${JSON.stringify(label)})`);
    const clickButton = label => chrome.evaluate(
      `(() => { const button = Array.from(document.querySelectorAll("button")).find(item => item.textContent?.trim() === ${JSON.stringify(label)}); if (!button) return false; button.click(); return true; })()`);
    await navigate(validToken);
    await until(() => hasButton("계정 상태 확인"), "recovery ID form");
    if (!await clickButton("계정 상태 확인")) throw new Error("ID check button could not be clicked");
    await until(() => hasButton("마스터 비밀번호 등록"), "master password registration button");
    await navigate(expiredToken);
    try {
      await until(() => chrome.evaluate(
        'document.body?.innerText.includes("복구 링크가 만료됐거나 유효하지 않습니다.")'),
      "expired grant error");
    } catch {
      const screen = await chrome.evaluate("document.body?.innerText.slice(0, 300)");
      throw new Error(`Expired grant screen: ${screen}`);
    }
    if (await hasButton("마스터 비밀번호 등록")) throw new Error("Expired grant showed registration");
    await db.execute("UPDATE staff SET security_password_hash='configured-test-hash' WHERE staff_id=?",
      [staffId]);
    await navigate(validToken);
    await until(() => hasButton("계정 상태 확인"), "configured owner ID form");
    if (!await clickButton("계정 상태 확인")) throw new Error("Configured ID check button could not be clicked");
    await until(() => hasButton("마스터 비밀번호 재설정"), "master password reset button");
    if (await hasButton("마스터 비밀번호 등록")) throw new Error("Configured owner showed registration");
    process.stdout.write(JSON.stringify({ db: "TDK_POS_TEST", ui: "pass",
      checked: ["id-confirmation", "first-registration", "expired-grant", "existing-password-reset"] }) + "\n");
  } finally {
    if (chrome) {
      chrome.socket.close();
      chrome.browser.kill();
    }
    if (staffId !== null) {
      await db.execute("DELETE FROM master_password_recovery_grants WHERE staff_id=?", [staffId]);
      await db.execute("DELETE FROM admin_security_owners WHERE staff_id=?", [staffId]);
      await db.execute("DELETE FROM staff WHERE staff_id=? AND staff_code=?", [staffId, staffCode]);
    }
    if (originalLimit !== undefined) {
      await db.execute("DELETE FROM admin_auth_attempts WHERE attempt_key=?", [statusLimitKey]);
      if (originalLimit) await db.execute("INSERT INTO admin_auth_attempts " +
        "(attempt_key,window_started_at,attempt_count,updated_at) VALUES (?,?,?,?)",
      [statusLimitKey, originalLimit.started_at, originalLimit.attempt_count, originalLimit.updated_at]);
    }
    await db.end();
    const safeRoot = await fs.realpath(os.tmpdir());
    const safeProfile = await fs.realpath(profile);
    if (!safeProfile.startsWith(safeRoot + path.sep) || !path.basename(safeProfile).startsWith("tdk-adm-recovery-"))
      throw new Error("Unexpected Chrome profile location");
    await fs.rm(safeProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
}

main().catch(error => {
  console.error("ADM recovery UI check failed", { code: error.code ?? error.name, message: error.message });
  process.exitCode = 1;
});
