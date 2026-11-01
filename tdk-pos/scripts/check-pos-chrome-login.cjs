/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { randomBytes, randomInt, scrypt } = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

const origin = "http://localhost:3000";
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function hashCredential(value) {
  const salt = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => scrypt(value, salt, 64,
    { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(`scrypt$16384$8$1$${salt}$${key.toString("hex")}`)));
}

async function main() {
  assert.equal(process.env.DB_NAME, "TDK_POS_TEST", "only TDK_POS_TEST is allowed");
  const connection = await mysql.createConnection({ host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const suffix = randomBytes(6).toString("hex");
  const loginId = `poschr${suffix}`;
  const staffCode = `POS-CHROME-${suffix.toUpperCase()}`;
  const password = `P9#${randomBytes(18).toString("base64url")}`;
  let pin;
  do { pin = String(randomInt(100000, 1000000)); }
  while (/^(\d)\1{5}$/.test(pin) || "0123456789".includes(pin) ||
    "9876543210".includes(pin) || pin.slice(0, 3) === pin.slice(3));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "tdk-pos-login-"));
  let browser;
  let socket;
  let staffId;
  let sequence = 0;
  const pending = new Map();
  const requests = [];
  const waitFor = async (probe, label, timeoutMs = 20000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { const value = await probe(); if (value) return value; } catch { /* UI transition in progress. */ }
      await delay(100);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };

  try {
    const [created] = await connection.execute("INSERT INTO staff " +
      "(staff_code,name,admin_login_id,employee_pin_hash,security_password_hash," +
      "security_password_change_required,pos_enabled,kds_enabled,admin_enabled,is_active,role,kds_pin_change_required) " +
      "VALUES (?, 'POS Chrome Auth Test', ?, ?, ?, 0, 1, 0, 0, 1, 'STAFF', 0)",
    [staffCode, loginId, await hashCredential(pin), await hashCredential(password)]);
    staffId = Number(created.insertId);

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
      if (message.method === "Network.requestWillBeSent") {
        const url = new URL(message.params.request.url);
        if (url.hostname === "localhost" && url.pathname.startsWith("/api/"))
          requests.push(`${message.params.request.method} ${url.pathname}`);
      }
      if (!message.id) return;
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 10000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true });
      if (result.exceptionDetails) throw new Error("Chrome evaluation failed");
      return result.result.value;
    };
    await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
    await send("Page.navigate", { url: `${origin}/tdkpos/login` });
    await waitFor(() => evaluate('document.querySelector("main > section form input[type=text]") !== null'),
      "POS ID-only first screen");
    const first = await evaluate(`({ inputs: [...document.querySelectorAll("main > section form input")].map(i => i.type),
      title: document.body.innerText, focused: document.activeElement?.type })`);
    assert.deepEqual(first.inputs, ["text"], "the first screen must request ID only");
    assert.ok(first.title.includes("POS 로그인"));
    assert.ok(first.title.includes("ID를 입력한 후 다음 버튼을 눌러주세요."));
    assert.equal(first.focused, "text");

    await evaluate(`(() => { const input = document.querySelector('main > section form input[type="text"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(loginId)}); input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector('main > section form button[type="submit"]').click(); return true; })()`);
    await waitFor(() => evaluate('document.querySelectorAll("main > section form input[type=password]").length === 1'),
      "POS master-password phase");
    const passwordPhase = await evaluate(`({ inputs: [...document.querySelectorAll("main > section form input")].map(i => i.type),
      text: document.body.innerText, focus: document.activeElement?.type,
      id: document.querySelector('main > section form input[type="text"]')?.value })`);
    assert.deepEqual(passwordPhase.inputs, ["text", "password"]);
    assert.equal(passwordPhase.id, loginId);
    assert.equal(passwordPhase.focus, "password");
    assert.ok(passwordPhase.text.includes("마스터 비밀번호를 입력해 주세요."));

    await evaluate(`(() => { const input = document.querySelector('main > section form input[type="password"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(password)}); input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector('main > section form button[type="submit"]').click(); return true; })()`);
    await waitFor(() => evaluate('document.body.innerText.includes("개인 6자리 PIN") && document.querySelector("main > section form input[readonly]") !== null'),
      "POS shared PIN phase");
    const pinPhase = await evaluate(`({ text: document.body.innerText,
      id: document.querySelector('main > section form input[readonly]')?.value,
      focus: document.activeElement?.type })`);
    assert.equal(pinPhase.id, loginId);
    assert.equal(pinPhase.focus, "password");

    const pinInputMode = await evaluate('document.querySelector("main > section form input[type=password]").getAttribute("inputmode")');
    assert.equal(pinInputMode, "numeric");
    await evaluate(`(() => { const input = document.querySelector('main > section form input[type="password"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(pin)}); input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector('main > section form button[type="submit"]').click(); return true; })()`);
    await waitFor(() => evaluate('document.querySelector("[data-pos-app]") !== null'), "POS main page", 30000);
    const posText = await evaluate('document.body.innerText.slice(0, 200)');
    const cookieNames = await evaluate('document.cookie');
    assert.doesNotMatch(cookieNames, /tdk_pos_trust/i, "trust token must be HttpOnly");
    assert.equal(requests.filter(item => item === "GET /api/auth/trust").length, 1,
      "one POS ID status lookup should occur");
    assert.equal(requests.filter(item => item === "POST /api/auth/trust").length, 1,
      "one master-password trust enrollment should occur");
    assert.equal(requests.filter(item => item === "POST /api/auth/login").length, 1,
      "PIN login must issue exactly one final login request");
    assert.equal(requests.filter(item => item.includes("verify-pin")).length, 0,
      "legacy duplicate PIN preflight must not be called");
    const [tokens] = await connection.execute("SELECT token_hash FROM program_trust_tokens " +
      "WHERE enrolled_by_staff_id=? AND program='POS' AND revoked_at IS NULL", [staffId]);
    assert.equal(tokens.length, 1, "one active POS trust token must be stored");
    assert.match(tokens[0].token_hash, /^[a-f0-9]{64}$/i, "the POS token must be stored as a SHA-256 hash");
    const [sessions] = await connection.execute("SELECT COUNT(*) AS count FROM staff_sessions " +
      "WHERE staff_id=? AND session_type='POS' AND status='ACTIVE' AND trust_token_id IS NOT NULL", [staffId]);
    assert.equal(Number(sessions[0].count), 1, "POS session must be created after PIN login");
    process.stdout.write(JSON.stringify({ db: "TDK_POS_TEST", browser: "Chrome", flow: "ID-master-password-POS-token-PIN-session-POS-page",
      firstScreen: "ID only", passwordFocus: "PASS", pinFlow: "PASS", POSMainPage: "PASS",
      apiCalls: requests, posPageText: posText }) + "\n");
  } finally {
    socket?.close(); browser?.kill();
    if (staffId !== undefined) {
      await connection.execute("DELETE FROM staff_sessions WHERE staff_id=?", [staffId]);
      await connection.execute("DELETE FROM audit_logs WHERE staff_id=?", [staffId]);
      await connection.execute("DELETE FROM program_trust_tokens WHERE enrolled_by_staff_id=?", [staffId]);
      await connection.execute("DELETE FROM staff WHERE staff_id=? AND staff_code=?", [staffId, staffCode]);
      process.stdout.write(JSON.stringify({ db: "TDK_POS_TEST", cleanup: "complete" }) + "\n");
    }
    await connection.end();
    const safeRoot = await fs.realpath(os.tmpdir());
    const safeProfile = await fs.realpath(profile);
    assert.ok(safeProfile.startsWith(safeRoot + path.sep) && path.basename(safeProfile).startsWith("tdk-pos-login-"));
    await fs.rm(safeProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
}

main().catch(error => {
  console.error("POS Chrome login check failed", { name: error.name, message: error.message, code: error.code });
  process.exitCode = 1;
});
