/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { randomBytes, randomInt } = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

const origin = "http://localhost:3000";
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const idHelper = "ID\uB97C \uC785\uB825\uD55C \uD6C4 \uB2E4\uC74C \uBC84\uD2BC\uC744 \uB20C\uB7EC\uC8FC\uC138\uC694.";
const passwordHelper = "\uB9C8\uC2A4\uD130 \uBE44\uBC00\uBC88\uD638\uB97C \uC785\uB825\uD574 \uC8FC\uC138\uC694.";

async function main() {
  assert.equal(process.env.DB_NAME, "TDK_POS_TEST", "only the isolated development database is allowed");
  const connection = await mysql.createConnection({ host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const suffix = randomBytes(6).toString("hex");
  const loginId = `chrom${suffix}`;
  const staffCode = `CHROME-${suffix.toUpperCase()}`;
  const password = `K9#${randomBytes(18).toString("base64url")}`;
  let pin;
  do { pin = String(randomInt(100000, 1000000)); }
  while (/^(\d)\1{5}$/.test(pin) || "0123456789".includes(pin) ||
    "9876543210".includes(pin) || pin.slice(0, 3) === pin.slice(3));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "tdk-kds-login-"));
  let browser;
  let socket;
  let staffId;
  let sequence = 0;
  const pending = new Map();

  const waitFor = async (probe, label, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { const value = await probe(); if (value) return value; } catch { /* UI may be transitioning. */ }
      await delay(100);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };

  try {
    const [inserted] = await connection.execute("INSERT INTO staff " +
      "(staff_code,name,admin_login_id,employee_pin_hash,security_password_hash,security_password_change_required," +
      "pos_enabled,kds_enabled,admin_enabled,is_active,role,kds_pin_change_required) " +
      "VALUES (?,'KDS Chrome Auth Test',?,NULL,NULL,1,1,1,0,1,'STAFF',0)", [staffCode, loginId]);
    staffId = Number(inserted.insertId);

    browser = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run",
      "--remote-allow-origins=*", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore", windowsHide: true });
    const portFile = path.join(profile, "DevToolsActivePort");
    const port = await waitFor(async () => {
      try { return Number((await fs.readFile(portFile, "utf8")).split(/\r?\n/)[0]) || null; }
      catch { return null; }
    }, "Chrome DevTools port");
    const page = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      return (await response.json()).find(item => item.type === "page" && item.webSocketDebuggerUrl);
    }, "Chrome page");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 8000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true });
      if (result.exceptionDetails) throw new Error("Chrome evaluation failed");
      return result.result.value;
    };
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Page.navigate", { url: `${origin}/tdkkds` });
    await waitFor(() => evaluate('document.querySelector("main > section form input[type=text]") !== null'),
      "KDS ID-only first screen");
    const firstScreen = await evaluate(`({ inputs: [...document.querySelectorAll("main > section form input")].map(i => i.type),
      text: document.body.innerText, focused: document.activeElement?.type })`);
    assert.deepEqual(firstScreen.inputs, ["text"], "the first screen must request ID only");
    assert.ok(firstScreen.text.includes(idHelper), "ID stage must show the ADM guidance copy");
    assert.equal(firstScreen.focused, "text", "ID input must receive focus");

    await evaluate(`(() => { const input = document.querySelector('main > section form input[type="text"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(loginId)}); input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector('main > section form button[type="submit"]').click(); return true; })()`);
    await waitFor(() => evaluate('document.querySelector("dialog[open]") !== null'), "reset-authorized registration dialog");
    assert.ok(await evaluate('document.querySelector("dialog[open]") !== null'));
    const registrationInputs = await evaluate(`Array.from(document.querySelectorAll("dialog[open] input[type=password]"))
      .map(input => input.outerHTML)`);
    assert.equal(registrationInputs.length, 2, "registration must ask for and confirm a master password");
    await evaluate(`(() => { const inputs = [...document.querySelectorAll("dialog[open] input[type=password]")];
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(inputs[0], ${JSON.stringify(password)}); inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(inputs[1], ${JSON.stringify(password)}); inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
      [...document.querySelectorAll("dialog[open] button")].find(button => button.type === "submit").click(); return true; })()`);
    await waitFor(() => evaluate(`document.querySelector("dialog[open]") === null &&
      document.querySelector("main > section form input[type=password]") !== null`), "master authentication phase");
    const passwordPhase = await evaluate(`({ text: document.body.innerText,
      focusType: document.activeElement?.type, inputs: [...document.querySelectorAll("main > section form input")].map(i => i.type) })`);
    assert.deepEqual(passwordPhase.inputs, ["text", "password"]);
    assert.ok(passwordPhase.text.includes(passwordHelper), "password phase must show the ADM guidance copy");
    assert.equal(passwordPhase.focusType, "password", "master-password input must receive focus");

    await evaluate(`(() => { const input = document.querySelector('main > section form input[type="password"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(password)}); input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector('main > section form button[type="submit"]').click(); return true; })()`);
    await waitFor(() => evaluate(`document.querySelectorAll('main > section form input[type="password"]').length === 2`),
      "shared PIN setup phase");
    await evaluate(`(() => { const inputs = [...document.querySelectorAll('main > section form input[type="password"]')];
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(inputs[0], ${JSON.stringify(pin)}); inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(inputs[1], ${JSON.stringify(pin)}); inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector('main > section form button[type="submit"]').click(); return true; })()`);
    await waitFor(() => evaluate('document.querySelector("[data-kds-display]") !== null'),
      "KDS main screen", 20000);
    const mainScreen = await evaluate('document.body.innerText.slice(0, 240)');
    const tokenCookie = await evaluate('document.cookie');
    assert.doesNotMatch(tokenCookie, /tdk_kds_trust/i, "trust token must remain HttpOnly");
    process.stdout.write(JSON.stringify({ db: "TDK_POS_TEST", browser: "Chrome", flow: "registration-master-auth-token-PIN-KDS-page",
      firstScreen: "ID only", masterPasswordFocus: "PASS", pinSetup: "PASS", mainPageText: mainScreen }) + "\n");
  } finally {
    socket?.close();
    browser?.kill();
    if (staffId !== undefined) {
      await connection.execute("DELETE FROM staff_sessions WHERE staff_id=?", [staffId]);
      await connection.execute("DELETE FROM audit_logs WHERE staff_id=?", [staffId]);
      await connection.execute("DELETE FROM program_trust_tokens WHERE enrolled_by_staff_id=?", [staffId]);
      await connection.execute("DELETE FROM kds_login_attempts WHERE staff_id=?", [staffId]);
      await connection.execute("DELETE FROM staff WHERE staff_id=? AND staff_code=?", [staffId, staffCode]);
      process.stdout.write(JSON.stringify({ db: "TDK_POS_TEST", cleanup: "complete" }) + "\n");
    }
    await connection.end();
    const safeRoot = await fs.realpath(os.tmpdir());
    const safeProfile = await fs.realpath(profile);
    assert.ok(safeProfile.startsWith(safeRoot + path.sep) && path.basename(safeProfile).startsWith("tdk-kds-login-"),
      "Chrome profile must remain under the temporary directory");
    await fs.rm(safeProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
}

main().catch(error => {
  console.error("KDS Chrome login check failed", { name: error.name, message: error.message, code: error.code });
  process.exitCode = 1;
});
