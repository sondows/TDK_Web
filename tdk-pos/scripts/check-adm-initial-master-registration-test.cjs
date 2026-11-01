/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { randomBytes, createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

const origin = "http://localhost:3000";
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, count = 160) {
  for (let i = 0; i < count; i++) {
    try { const value = await check(); if (value) return value; } catch { /* Navigation in progress. */ }
    await delay(150);
  }
  throw new Error(`Timed out: ${label}`);
}
async function post(url, body, headers = {}) {
  const response = await fetch(origin + url, { method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
    body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
async function postWithHost(url, body, host) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port: 3000, path: url, method: "POST",
      headers: { host, origin: `https://${host}`, "content-type": "application/json" } },
    response => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
    request.on("error", reject);
    request.end(JSON.stringify(body));
  });
}

async function main() {
  assert.equal(process.env.DB_NAME, "TDK_POS_TEST", "Only TDK_POS_TEST is allowed");
  const db = await mysql.createConnection({ host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const suffix = randomBytes(6).toString("hex");
  const loginId = `first${suffix}`;
  const staffCode = `FIRST-${suffix}`;
  const pinSentinel = `unchanged-pin-${suffix}`;
  const ownerSentinel = `unchanged-owner-${suffix}`;
  const password = `P7!${randomBytes(24).toString("base64url")}`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "tdk-adm-initial-master-"));
  let staffId = null;
  let browser;
  let socket;
  try {
    const [inserted] = await db.execute("INSERT INTO staff " +
      "(staff_code,name,admin_login_id,employee_pin_hash,role,is_active,admin_enabled,kds_pin_change_required) " +
      "VALUES (?,'Initial Master Test',?,?, 'OWNER',1,1,0)", [staffCode, loginId, pinSentinel]);
    staffId = Number(inserted.insertId);
    await db.execute("INSERT INTO admin_security_owners (staff_id,password_hash,credential_state) " +
      "VALUES (?,?, 'ACTIVE')", [staffId, ownerSentinel]);
    assert.equal((await post("/api/admin-center/trust/initial-master/status", { loginId })).body.available, true);
    assert.equal(await postWithHost("/api/admin-center/trust/initial-master/status",
      { loginId }, "tdkon.myasustor.com"), 403);
    assert.equal(await postWithHost("/api/program-trust/master-recovery/register-initial",
      { loginId, password, confirmPassword: password }, "tdkon.myasustor.com"), 403);
    assert.equal((await post("/api/program-trust/master-recovery/register-initial",
      { loginId, password: "weak", confirmPassword: "weak" })).status, 400);
    assert.equal((await post("/api/program-trust/master-recovery/register-initial",
      { loginId, password, confirmPassword: password + "x" })).status, 400);

    browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--disable-extensions",
      "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore", windowsHide: true });
    const port = await until(async () => Number((await fs.readFile(path.join(profile,
      "DevToolsActivePort"), "utf8")).split(/\r?\n/)[0]) || null, "Chrome port");
    const page = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`))
      .json()).find(item => item.type === "page" && item.webSocketDebuggerUrl), "Chrome page");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.method === "Fetch.requestPaused") {
        socket.send(JSON.stringify({ id: ++sequence, method: "Fetch.fulfillRequest", params: {
          requestId: message.params.requestId, responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from('{"available":true}').toString("base64"),
        } }));
        return;
      }
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + " timeout")); }, 10000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); } });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true });
      if (result.exceptionDetails) throw new Error("Browser expression failed: " + expression.slice(0, 80));
      return result.result.value;
    };
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Page.navigate", { url: origin + "/tdkadm/login" });
    await until(() => evaluate('document.querySelector(\'input[autocomplete="username"]\')?.value === ""'),
      "ADM login");
    await delay(1500);
    await evaluate('document.querySelector(\'input[autocomplete="username"]\').focus()');
    await send("Input.insertText", { text: "sondows" });
    await delay(250);
    await evaluate('document.querySelector(\'input[autocomplete="username"]\').blur()');
    await until(() => evaluate('document.querySelector("dialog")?.open === true'),
      "sondows registration dialog");
    assert.equal(await evaluate('document.querySelector("dialog h2")?.textContent?.trim()'),
      "마스터 비밀번호 등록");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape",
      windowsVirtualKeyCode: 27 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape",
      windowsVirtualKeyCode: 27 });
    await until(() => evaluate('document.querySelector("dialog")?.open === false'),
      "sondows dialog close");
    await evaluate('document.querySelector(\'input[autocomplete="username"]\').focus()');
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter",
      text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter",
      windowsVirtualKeyCode: 13 });
    await until(() => evaluate('document.querySelector("dialog")?.open === true'),
      "sondows registration dialog after Enter");
    await send("Page.navigate", { url: origin + "/tdkadm/login" });
    await until(() => evaluate('document.querySelector(\'input[autocomplete="username"]\')?.value === ""'),
      "fresh ADM login");
    await delay(1000);
    await evaluate('document.querySelector(\'input[autocomplete="username"]\').focus()');
    await send("Input.insertText", { text: loginId });
    await delay(250);
    await evaluate('document.querySelector(\'input[autocomplete="username"]\').blur()');
    try {
      await until(() => evaluate('document.querySelector("dialog")?.open === true'), "registration dialog");
    } catch (error) {
      const state = await evaluate(`({ id: document.querySelector('input[autocomplete="username"]')?.value,
        body: document.body?.innerText.slice(0, 500), dialog: document.querySelector("dialog")?.open })`);
      throw new Error(error.message + " " + JSON.stringify(state));
    }
    assert.equal(await evaluate('document.querySelector("dialog h2")?.textContent?.trim()'),
      "마스터 비밀번호 등록");
    await evaluate(`(() => { const inputs = document.querySelectorAll("dialog input");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      inputs.forEach(input => { setter.call(input, ${JSON.stringify(password)});
        input.dispatchEvent(new InputEvent("input", { bubbles: true })); }); })()`);
    await until(() => evaluate('Array.from(document.querySelectorAll("dialog button")).some(b => b.textContent.trim() === "등록" && !b.disabled)'),
      "registration button");
    await evaluate('Array.from(document.querySelectorAll("dialog button")).find(b => b.textContent.trim() === "등록").click()');
    await until(() => evaluate('document.querySelector("dialog")?.open === false && ' +
      'Array.from(document.querySelectorAll("button")).some(b => b.textContent.trim() === "인증")'),
    "ADM first auth return");
    assert.equal(await evaluate('document.querySelector(\'input[autocomplete="username"]\')?.value'), loginId);
    assert.equal(await evaluate('document.querySelector(\'input[autocomplete="current-password"]\')?.value'), "");
    const [rows] = await db.execute("SELECT s.security_password_hash,s.employee_pin_hash,s.role," +
      "s.admin_enabled,o.password_hash AS owner_password_hash,o.credential_state " +
      "FROM staff s JOIN admin_security_owners o ON o.staff_id=s.staff_id WHERE s.staff_id=?", [staffId]);
    assert.ok(rows[0].security_password_hash?.startsWith("scrypt$"));
    assert.notEqual(rows[0].security_password_hash, password);
    assert.equal(rows[0].employee_pin_hash, pinSentinel);
    assert.equal(rows[0].role, "OWNER");
    assert.equal(Number(rows[0].admin_enabled), 1);
    assert.equal(rows[0].owner_password_hash, ownerSentinel);
    assert.equal(rows[0].credential_state, "ACTIVE");
    assert.equal((await post("/api/admin-center/trust/initial-master/status", { loginId })).body.available, false);
    assert.equal((await post("/api/program-trust/master-recovery/register-initial",
      { loginId, password, confirmPassword: password })).status, 409);
    const [access] = await db.execute("SELECT " +
      "(SELECT COUNT(*) FROM program_trust_tokens WHERE enrolled_by_staff_id=?) AS token_count," +
      "(SELECT COUNT(*) FROM staff_sessions WHERE staff_id=?) AS session_count",
    [staffId, staffId]);
    assert.equal(Number(access[0].token_count), 0);
    assert.equal(Number(access[0].session_count), 0);
    await send("Fetch.enable", { patterns: [{ urlPattern: "*api/admin-center/trust/initialize",
      requestStage: "Request" }] });
    await send("Page.navigate", { url: origin + "/tdkadm/login" });
    await until(() => evaluate('document.querySelector("main h1")?.nextElementSibling?.textContent?.trim() === "최고관리자 최초 등록"'),
      "fresh install browser form");
    assert.equal(await evaluate('document.querySelectorAll("main section form input").length'), 3);
    await send("Fetch.disable");
    console.log(JSON.stringify({ browser: true, firstInstallFormMocked: true,
      sondowsDialog: true, status: true, externalDenied: true,
      hashSaved: true, replayDenied: true, pinAndOwnerPreserved: true, loginReturn: true }));
  } finally {
    socket?.close();
    browser?.kill();
    await db.execute("DELETE FROM audit_logs WHERE staff_id=?", [staffId]).catch(() => {});
    await db.execute("DELETE FROM admin_auth_attempts WHERE attempt_key=?",
      [createHash("sha256").update(`master-password-initial:account:${loginId}`).digest("hex")]).catch(() => {});
    if (staffId) {
      await db.execute("DELETE FROM admin_security_owners WHERE staff_id=?", [staffId]);
      await db.execute("DELETE FROM staff WHERE staff_id=? AND staff_code=?", [staffId, staffCode]);
    }
    await db.end();
    if (!path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error("Chrome profile escaped the temporary directory");
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
