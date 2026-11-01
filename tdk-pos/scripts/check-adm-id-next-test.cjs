/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { createHash, randomBytes, randomInt, scrypt } = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env.local", quiet: true });

const origin = "http://localhost:3000";
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const expectAuthorizedSetup = process.env.TDK_EXPECT_SETUP_AVAILABLE === "1";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hashCredential = value => new Promise((resolve, reject) => {
  const salt = randomBytes(16).toString("hex");
  scrypt(value, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(`scrypt$16384$8$1$${salt}$${key.toString("hex")}`));
});

async function main() {
  assert.equal(process.env.DB_NAME, "TDK_POS_TEST", "only the development database is allowed");
  const db = await mysql.createConnection({ host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const suffix = randomBytes(6).toString("hex");
  const ownerLogin = `admchrom${suffix}`;
  const ownerCode = `ADM-CHROME-${suffix}`;
  const targetLogin = `staffchrom${suffix}`;
  const targetCode = `STAFF-CHROME-${suffix}`;
  const ownerPassword = `K7#${randomBytes(20).toString("base64url")}`;
  const ownerPin = String(100000 + randomInt(900000));
  const targetPassword = `T8#${randomBytes(20).toString("base64url")}`;
  const targetPin = String(100000 + randomInt(900000));
  let ownerId = 0;
  let targetId = 0;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "tdk-adm-id-next-"));
  let browser;
  let socket;
  try {
    const [owner] = await db.execute("INSERT INTO staff " +
      "(staff_code,name,admin_login_id,employee_pin_hash,security_password_hash," +
      "security_password_change_required,pos_enabled,kds_enabled,admin_enabled,is_active,role,kds_pin_change_required) " +
      "VALUES (?,'ADM Chrome Regression Owner',?,?,?,?,1,1,1,1,'OWNER',0)",
    [ownerCode, ownerLogin, await hashCredential(ownerPin), await hashCredential(ownerPassword), 0]);
    ownerId = Number(owner.insertId);
    await db.execute("INSERT INTO admin_security_owners (staff_id,password_hash,credential_state) " +
      "VALUES (?,?,'ACTIVE')", [ownerId, await hashCredential(ownerPassword)]);
    const [target] = await db.execute("INSERT INTO staff " +
      "(staff_code,name,admin_login_id,employee_pin_hash,security_password_hash," +
      "security_password_change_required,pos_enabled,kds_enabled,admin_enabled,is_active,role,kds_pin_change_required) " +
      "VALUES (?,'Staff UI Regression Target',?,?,?,?,1,1,1,1,'STAFF',0)",
    [targetCode, targetLogin, await hashCredential(targetPin), await hashCredential(targetPassword), 0]);
    targetId = Number(target.insertId);
    for (const program of ["POS", "ADM", "KDS", "HOS"]) {
      const raw = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(raw).digest("hex");
      await db.execute("INSERT INTO program_trust_tokens (program,token_hash,enrolled_by_staff_id) VALUES (?,?,?)",
        [program, tokenHash, targetId]);
    }
    browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--disable-extensions",
      "--no-first-run", "--remote-allow-origins=*", "--remote-debugging-port=0",
      `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore", windowsHide: true });
    const until = async (check, label, limit = 100) => {
      for (let i = 0; i < limit; i++) {
        try { const result = await check(); if (result) return result; }
        catch { /* A page navigation may replace the execution context. */ }
        await delay(150);
      }
      const detail = await evaluate('document.body.innerText + "\\nINPUTS=" + Array.from(document.querySelectorAll("input")).map(i => [i.type, i.autocomplete, !!i.closest("dialog"), i.outerHTML]).join(" | ")').catch(() => "<unavailable>");
      throw new Error(`Timed out waiting for ${label}: ${detail}`);
    };
    const port = await until(async () => Number((await fs.readFile(
      path.join(profile, "DevToolsActivePort"), "utf8")).split(/\r?\n/)[0]) || null, "Chrome port");
    const page = await until(async () => (await (await fetch(
      `http://127.0.0.1:${port}/json/list`)).json())
      .find(item => item.type === "page" && item.webSocketDebuggerUrl), "Chrome page");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let sequence = 0;
    const pending = new Map();
    const requests = [];
    const paused = [];
    let scenario = "";
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.method === "Network.requestWillBeSent") {
        const request = message.params.request;
        const pathname = new URL(request.url).pathname;
        if (pathname.startsWith("/api/")) requests.push({ id: message.params.requestId,
          method: request.method, url: request.url, path: pathname, body: request.postData ?? "" });
      }
      if (message.method === "Network.responseReceived") {
        const request = requests.find(item => item.id === message.params.requestId);
        if (request) request.status = message.params.response.status;
      }
      if (message.method === "Fetch.requestPaused") {
        paused.push(message.params);
        if (scenario !== "hold") void fulfill(message.params);
        return;
      }
      if (!message.id) return;
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + " timeout")); }, 8000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); } });
      socket.send(JSON.stringify({ id, method, params }));
    });
    function mockResponse(request) {
      const url = new URL(request.request.url);
      if (request.request.url.includes("/api/admin-center/trust/initialize"))
        return { status: 200, body: { available: scenario === "bootstrap" } };
      if (request.request.url.includes("/api/admin-center/trust/initial-master/status")) {
        const loginId = JSON.parse(request.request.postData ?? "{}").loginId;
        if (scenario === "failure") return { status: 503, body: { available: false } };
        const available = scenario === "register" && loginId === "sondows";
        const accountFound = loginId !== "missing";
        const passwordConfigured = scenario === "password" || scenario === "pin";
        return { status: 200, body: { state: available ? "MASTER_PASSWORD_REQUIRED" :
          passwordConfigured ? "MASTER_PASSWORD_SET" : "REGISTRATION_NOT_ALLOWED", available, accountFound,
          passwordConfigured } };
      }
      if (url.pathname === "/api/admin-center/trust") {
        const loginId = url.searchParams.get("loginId");
        const trusted = scenario === "pin" && loginId === "tokenuser";
        return { status: 200, body: { success: true, trusted, invalidated: false,
          pinSetupRequired: false, ...(trusted ? { loginId } : {}) } };
      }
      return { status: 500, body: { success: false } };
    }
    async function fulfill(request) {
      const result = mockResponse(request);
      await send("Fetch.fulfillRequest", { requestId: request.requestId, responseCode: result.status,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(result.body)).toString("base64") });
    }
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true });
      if (result.exceptionDetails) throw new Error(`Browser expression failed: ${expression.slice(0, 100)}`);
      return result.result.value;
    };
    const start = async () => {
      await send("Page.navigate", { url: origin + "/tdkadm/login" });
      await until(() => evaluate('document.querySelector(\'input[autocomplete="username"]\') !== null'),
        "ID stage");
      await until(() => evaluate('Array.from(document.querySelectorAll("button")).some(b => b.textContent.trim() === "다음")'),
        "Next button");
    };
    const enterId = async loginId => {
      await evaluate('document.querySelector(\'input[autocomplete="username"]\').focus(); document.querySelector(\'input[autocomplete="username"]\').select()');
      await send("Input.insertText", { text: loginId });
      await until(() => evaluate(`document.querySelector('input[autocomplete="username"]')?.value === ${JSON.stringify(loginId)}`),
        "ID value");
    };
    const clickNext = async () => evaluate(
      'Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "다음")?.click()');
    const inputCount = () => evaluate('document.querySelectorAll("main section input").length');
    const hasDialog = () => evaluate('document.querySelector("dialog")?.open === true');
    const hasPassword = () => evaluate('document.querySelector(\'main > section > form input[autocomplete="current-password"]\') !== null');

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    await start();
    assert.equal(await inputCount(), 1, "first ADM screen contains only the ID field");
    assert.equal(await hasPassword(), false, "password is hidden before Next");
    assert.equal(requests.some(item => item.path.includes("initial-master/status")), false,
      "ID entry alone must not query account status");
    await enterId("sondows");
    assert.equal(requests.some(item => item.path.includes("initial-master/status")), false,
      "typing must not query account status");
    await clickNext();
    const realStatus = await until(() => requests.find(item =>
      item.path === "/api/admin-center/trust/initial-master/status" && item.status), "real setup status response");
    assert.equal(JSON.parse(realStatus.body).loginId, "sondows");
    if (expectAuthorizedSetup) {
      assert.equal(realStatus.status, 200, "authorized local setup mode must allow status lookup");
      const realStatusBody = await evaluate(`JSON.parse(${JSON.stringify(realStatus.body)})`);
      assert.deepEqual(realStatusBody, { state: "MASTER_PASSWORD_REQUIRED", available: true,
        accountFound: true, passwordConfigured: false },
        "TDK_POS_TEST account with a NULL master hash must be registration eligible");
      await until(() => hasDialog(), "actual authorized master registration screen");
      assert.equal(await hasPassword(), false, "authorized unregistered account must not go to password authentication");
    } else {
      assert.equal(realStatus.status, 200, "same-origin status check should return a non-authorizing result");
      await until(() => hasPassword(), "password authentication after setup-only status is denied");
      assert.equal(await evaluate('document.querySelector(\'input[autocomplete="username"]\')?.value'), "sondows");
      assert.equal(await evaluate('document.querySelector("[role=alert]")'), null,
        "setup-only 403 must not be shown as a login failure or reveal account status");
      assert.equal(await hasDialog(), false);
    }
    assert.equal(await evaluate('document.querySelector(\'input[autocomplete="username"]\')?.value'), "sondows");

    // Exercise the real ADM server/API with an isolated employee before enabling mocked UI branches.
    await start();
    await enterId(ownerLogin);
    await clickNext();
    await until(() => hasPassword(), "real ADM password screen");
    const passwordFocus = await evaluate("document.activeElement?.type");
    assert.equal(passwordFocus, "password", "ADM master-password input receives focus");
    await evaluate(`(() => { const input = document.querySelector('input[autocomplete="current-password"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(ownerPassword)}); input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      input.closest("form").querySelector("button[type=submit]").click(); return true; })()`);
    await until(() => evaluate('document.querySelector("#admin-login-pin") !== null'), "real ADM PIN screen");
    assert.equal(await evaluate('document.querySelector("#admin-login-id")?.value'), ownerLogin);
    assert.doesNotMatch(await evaluate("document.cookie"), /tdk_adm_trust/i, "ADM trust cookie is HttpOnly");
    const [ownerTokens] = await db.execute("SELECT program,token_hash FROM program_trust_tokens " +
      "WHERE enrolled_by_staff_id=? AND revoked_at IS NULL", [ownerId]);
    assert.equal(ownerTokens.length, 1);
    assert.equal(ownerTokens[0].program, "ADM");
    assert.match(ownerTokens[0].token_hash, /^[a-f0-9]{64}$/i);
    await evaluate(`(() => { const input = document.querySelector("#admin-login-pin");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(ownerPin)}); input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      input.closest("form").querySelector("button[type=submit]").click(); return true; })()`);
    await until(() => evaluate('location.pathname === "/tdkadm"'), "real ADM main page");
    const [adminSessions] = await db.execute("SELECT COUNT(*) AS count FROM staff_sessions " +
      "WHERE staff_id=? AND session_type='ADMIN' AND status='ACTIVE'", [ownerId]);
    assert.equal(Number(adminSessions[0].count), 1);

    await until(() => evaluate('Array.from(document.querySelectorAll("button")).some(button => button.textContent.includes("로그아웃"))'),
      "ADM logout control");
    await evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("로그아웃"))?.click()');
    const logoutRequest = await until(() => requests.find(item => item.path === "/api/admin-center/logout" && item.status),
      "ADM logout API response");
    assert.equal(logoutRequest.status, 200);
    const [loggedOutSessions] = await db.execute("SELECT COUNT(*) AS count FROM staff_sessions " +
      "WHERE staff_id=? AND session_type='ADMIN' AND status='ACTIVE'", [ownerId]);
    assert.equal(Number(loggedOutSessions[0].count), 0, "logout must revoke the browser session");
    await until(() => evaluate('location.pathname === "/tdkadm/login"'), "ADM logout redirect");
    await send("Page.navigate", { url: origin + "/tdkadm/login" });
    await until(() => evaluate('document.querySelector(\'input[autocomplete="username"]\') !== null'), "ADM login after logout");
    await enterId(ownerLogin);
    await clickNext();
    await until(() => evaluate('document.querySelector("#admin-login-pin") !== null'), "ADM PIN reconnect screen");
    await evaluate(`(() => { const input = document.querySelector("#admin-login-pin");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(ownerPin)}); input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      input.closest("form").querySelector("button[type=submit]").click(); return true; })()`);
    await until(() => evaluate('location.pathname === "/tdkadm"'), "ADM PIN reconnect main page");

    // Verify the actual staff screen and exercise cancel then confirm with a disposable target.
    const [ownerSessionRows] = await db.execute("SELECT session_token_hash FROM staff_sessions " +
      "WHERE staff_id=? AND session_type='ADMIN' AND status='ACTIVE' ORDER BY staff_session_id DESC LIMIT 1", [ownerId]);
    assert.equal(ownerSessionRows.length, 1);
    await db.execute("UPDATE staff_sessions SET owner_reauthenticated_at=NOW() " +
      "WHERE staff_id=? AND session_type='ADMIN' AND status='ACTIVE'", [ownerId]);
    await send("Page.navigate", { url: origin + "/tdkadm/security/staff" });
    await until(() => evaluate(`document.body.innerText.includes("${targetLogin}")`), "staff list target");
    const rowText = await evaluate(`Array.from(document.querySelectorAll("tr")).find(row => row.innerText.includes("${targetLogin}"))?.innerText ?? ""`);
    assert.ok(rowText.includes("Staff UI Regression Target"));
    const staffHeaders = await evaluate('Array.from(document.querySelectorAll("thead th")).map(cell => cell.innerText.trim())');
    const credentialStatusColumn = staffHeaders.some(text => /PIN|마스터|인증/.test(text));
    assert.equal(credentialStatusColumn, false, "the current staff list does not render credential registration status columns");
    await evaluate(`Array.from(document.querySelectorAll("tr")).find(row => row.innerText.includes("${targetLogin}"))?.querySelector("button")?.click()`);
    await until(() => evaluate('!!document.querySelector("#staff-modal-title")'), "staff edit dialog");
    const editLabels = await evaluate('Array.from(document.querySelector("#staff-modal-title").closest("dialog").querySelectorAll("label")).map(label => label.innerText.trim())');
    const credentialStatusField = editLabels.some(text => /PIN|마스터 비밀번호|등록 상태/.test(text));
    assert.equal(credentialStatusField, false, "the current edit form does not render credential registration state fields");
    await until(() => evaluate('!!Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("PIN"))'),
      "credential reset button");
    await evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("PIN")).click()');
    await until(() => evaluate('!!document.querySelector("#staff-security-title")'), "reset confirmation dialog");
    await evaluate('document.querySelector("#staff-security-title").closest("dialog").querySelectorAll("button")[1]?.click()');
    await until(() => evaluate('!document.querySelector("#staff-security-title")'), "reset cancellation");
    const [untouched] = await db.execute("SELECT security_password_hash IS NOT NULL AS password_set," +
      "employee_pin_hash IS NOT NULL AS pin_set FROM staff WHERE staff_id=?", [targetId]);
    assert.equal(Number(untouched[0].password_set), 1);
    assert.equal(Number(untouched[0].pin_set), 1);
    await evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("PIN")).click()');
    await until(() => evaluate('!!document.querySelector("#staff-security-title")'), "reset confirmation reopened");
    await evaluate('document.querySelector("#staff-security-title").closest("dialog").querySelectorAll("button")[2]?.click()');
    await until(async () => {
      const [state] = await db.execute("SELECT security_password_hash,employee_pin_hash FROM staff WHERE staff_id=?", [targetId]);
      return state[0]?.security_password_hash === null && state[0]?.employee_pin_hash === null;
    }, "UI reset request completed");
    const [resetTokens] = await db.execute("SELECT COUNT(*) AS count FROM program_trust_tokens " +
      "WHERE enrolled_by_staff_id=? AND revoke_reason='CREDENTIALS_RESET'", [targetId]);
    assert.equal(Number(resetTokens[0].count), 4);
    await until(() => evaluate('!document.querySelector("#staff-modal-title")'), "staff list refresh after reset");
    console.log(JSON.stringify({ actualAdmChromeLogin: "PASS", admPinReconnect: "PASS",
      staffListAndEdit: "PASS", credentialStatusColumn: credentialStatusColumn ? "PRESENT" : "NOT DISPLAYED",
      credentialStatusEditField: credentialStatusField ? "PRESENT" : "NOT DISPLAYED",
      resetCancel: "PASS", resetConfirmAndRefresh: "PASS" }));
    await evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("로그아웃"))?.click()');
    await until(() => requests.filter(item => item.path === "/api/admin-center/logout" && item.status === 200).length >= 2,
      "second ADM logout API response");

    await send("Fetch.enable", { patterns: [
      { urlPattern: "*api/admin-center/trust?*", requestStage: "Request" },
      { urlPattern: "*api/admin-center/trust/initialize*", requestStage: "Request" },
      { urlPattern: "*api/admin-center/trust/initial-master/status*", requestStage: "Request" },
    ] });

    scenario = "hold";
    await start();
    await enterId("worker");
    await clickNext();
    await until(() => paused.length >= 3, "three held status requests");
    assert.equal(await evaluate('document.querySelector("main > section button[type=submit]")?.disabled'),
      true, "Next is disabled while account checks are pending");
    await evaluate('document.querySelector("main > section button[type=submit]")?.click()');
    await delay(200);
    assert.equal(paused.length, 3, "double click must not create duplicate requests");
    scenario = "password";
    for (const request of paused.splice(0)) await fulfill(request);
    await until(() => hasPassword(), "password stage after normal status");
    assert.equal(await evaluate('document.querySelector(\'input[autocomplete="username"]\')?.value'), "worker");
    await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("ID 변경"))?.click()');

    scenario = "unauthorized";
    await start();
    await enterId("worker");
    await clickNext();
    await until(() => evaluate('document.querySelector("[role=alert]")?.textContent?.includes("최초 등록 권한이 없습니다")'),
      "unauthorized missing-password notice");
    assert.equal(await hasPassword(), false, "unregistered account without permission must not reach password authentication");

    scenario = "pin";
    await start();
    await enterId("tokenuser");
    await clickNext();
    await until(() => evaluate('document.querySelector(\'#admin-login-pin\') !== null'), "PIN screen");
    assert.equal(await evaluate('document.querySelector("#admin-login-id")?.value'), "tokenuser",
      "selected ID must carry into PIN screen");
    assert.equal(await evaluate('document.querySelector("#admin-login-id")?.readOnly'), true);
    await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("ID 변경"))?.click()');
    await until(() => evaluate('document.querySelector(\'input[autocomplete="username"]\') !== null'), "PIN back to ID");
    assert.equal(await evaluate('document.querySelector(\'input[autocomplete="username"]\')?.value'), "tokenuser");

    scenario = "bootstrap";
    await start();
    await enterId("firstowner");
    await clickNext();
    await until(() => evaluate('document.querySelector("main p")?.textContent?.trim() === "최고관리자 최초 등록"'),
      "first owner registration");
    assert.equal(await evaluate('document.querySelector(\'input[autocomplete="username"]\')?.value'), "firstowner");
    await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("ID 변경"))?.click()');
    await until(() => evaluate('document.querySelector(\'input[autocomplete="username"]\') !== null'), "bootstrap back");
    assert.equal(await evaluate('document.querySelector(\'input[autocomplete="username"]\')?.value'), "firstowner");

    scenario = "register";
    await start();
    await enterId("sondows");
    await clickNext();
    await until(() => hasDialog(), "authorized first password dialog");
    assert.equal(await evaluate('document.querySelector("dialog h2")?.textContent?.trim()'),
      "마스터 비밀번호 등록");

    scenario = "failure";
    await evaluate('document.querySelector("dialog")?.close()');
    await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("ID 변경"))?.click()');
    await until(() => evaluate('document.querySelector(\'input[autocomplete="username"]\') !== null'), "failure case ID");
    await enterId("sondows");
    await clickNext();
    await until(() => evaluate('document.querySelector("[role=alert]")?.textContent?.includes("계정 상태를 확인할 수 없습니다")'),
      "status failure message");
    assert.equal(await evaluate('document.querySelector(\'input[autocomplete="username"]\')?.value'), "sondows");

    console.log(JSON.stringify({ actualOrdinaryStatusHttp: realStatus.status, passwordFallback: true, nextOnly: true, duplicateBlocked: true,
      idPreservedOnPasswordBack: true, mockedTokenBranchAndIdPreserved: true, mockedBootstrapBranch: true,
      authorizedRegistrationBranch: true, statusFailureHandled: true }));
    await send("Fetch.disable");
  } finally {
    socket?.close();
    browser?.kill();
    for (const staffId of [targetId, ownerId].filter(Boolean)) {
      await db.execute("DELETE FROM staff_sessions WHERE staff_id=?", [staffId]).catch(() => {});
      await db.execute("DELETE FROM audit_logs WHERE staff_id=? OR entity_id=?", [staffId, targetId]).catch(() => {});
      await db.execute("DELETE FROM program_trust_tokens WHERE enrolled_by_staff_id=?", [staffId]).catch(() => {});
      await db.execute("DELETE FROM admin_security_owners WHERE staff_id=?", [staffId]).catch(() => {});
      await db.execute("DELETE FROM staff WHERE staff_id=?", [staffId]).catch(() => {});
    }
    await db.end();
    const safeRoot = await fs.realpath(os.tmpdir());
    const safeProfile = await fs.realpath(profile);
    if (!safeProfile.startsWith(safeRoot + path.sep) ||
      !path.basename(safeProfile).startsWith("tdk-adm-id-next-"))
      throw new Error("Unexpected Chrome profile location");
    await fs.rm(safeProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

main().catch(error => {
  console.error("ADM ID next flow check failed", { name: error.name, message: error.message });
  process.exitCode = 1;
});
