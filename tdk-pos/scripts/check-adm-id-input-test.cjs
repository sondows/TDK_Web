/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const expectSetup = process.env.TDK_EXPECT_NAS_SETUP === "1";
const mockStatus = process.env.TDK_MOCK_STATUS === "1";

const origin = "http://localhost:3000";
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, label) {
  for (let i = 0; i < 100; i++) {
    try { const result = await check(); if (result) return result; }
    catch { /* Navigation may replace the current execution context. */ }
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "tdk-adm-id-input-"));
  let browser;
  let socket;
  try {
    browser = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-extensions",
      "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore", windowsHide: true });
    const port = await until(async () => {
      const content = await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8");
      return Number(content.split(/\r?\n/)[0]) || null;
    }, "Chrome debugging port");
    const pages = await until(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await response.json();
      return list.find(page => page.type === "page" && page.webSocketDebuggerUrl);
    }, "Chrome page");
    socket = new WebSocket(pages.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      if (socket.readyState === WebSocket.OPEN) return resolve();
      const timer = setTimeout(() => reject(new Error("Chrome WebSocket open timeout")), 5000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", error => { clearTimeout(timer); reject(error); }, { once: true });
      socket.addEventListener("close", () => { clearTimeout(timer);
        reject(new Error("Chrome WebSocket closed before open")); }, { once: true });
    });
    let sequence = 0;
    const pending = new Map();
    const requests = [];
    const requestById = new Map();
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.method === "Fetch.requestPaused") {
        const loginId = JSON.parse(message.params.request.postData ?? "{}").loginId;
        socket.send(JSON.stringify({ id: ++sequence, method: "Fetch.fulfillRequest", params: {
          requestId: message.params.requestId, responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify({ available: loginId === "sondows" })).toString("base64"),
        } }));
        return;
      }
      if (message.method === "Network.requestWillBeSent") {
        const request = message.params.request;
        if (request.url.includes("/api/")) {
          const item = { method: request.method, path: new URL(request.url).pathname,
            body: request.postData ?? "" };
          requests.push(item);
          requestById.set(message.params.requestId, item);
        }
      }
      if (message.method === "Network.responseReceived") {
        const item = requestById.get(message.params.requestId);
        if (item) item.status = message.params.response.status;
      }
      if (message.method === "Network.loadingFinished") {
        const item = requestById.get(message.params.requestId);
        if (item?.path === "/api/admin-center/trust/initial-master/status") {
          void send("Network.getResponseBody", { requestId: message.params.requestId })
            .then(result => { item.response = JSON.parse(result.body); }).catch(() => {});
        }
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
      const timer = setTimeout(() => {
        pending.delete(id); reject(new Error(`Chrome command timed out: ${method}`));
      }, 5000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); } });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true });
      if (result.exceptionDetails) throw new Error("Browser expression failed");
      return result.result.value;
    };
    const state = () => evaluate(`(() => {
      const input = document.querySelector('input[autocomplete="username"]');
      if (!input) return null;
      const reactKey = Object.keys(input).find(key => key.startsWith("__reactProps$"));
      return { displayed: input.value, reactValue: reactKey ? input[reactKey].value : null,
        events: window.__tdkIdProbe ?? null };
    })()`);
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    if (mockStatus) await send("Fetch.enable", { patterns: [{
      urlPattern: "*api/admin-center/trust/initial-master/status", requestStage: "Request" }] });
    await send("Page.navigate", { url: `${origin}/tdkadm/login` });
    await until(async () => {
      const result = await state();
      return result && result.reactValue !== null;
    }, "ADM ID input");
    await evaluate(`(() => {
      const input = document.querySelector('input[autocomplete="username"]');
      const events = { input: 0, change: 0, blur: 0, enter: 0 };
      window.__tdkIdProbe = events;
      input.addEventListener("input", () => events.input++);
      input.addEventListener("change", () => events.change++);
      input.addEventListener("blur", () => events.blur++);
      input.addEventListener("keydown", event => { if (event.key === "Enter") events.enter++; });
      input.focus();
    })()`);
    await send("Input.insertText", { text: "sondows" });
    await until(async () => (await state())?.reactValue === "sondows", "React ID state");
    const typed = await state();
    assert.equal(typed.displayed, "sondows");
    assert.ok(typed.events.input > 0, "typing must raise input events");
    await evaluate("document.querySelector('input[autocomplete=\"username\"]').blur()");
    await until(() => requests.some(request => request.path ===
      "/api/admin-center/trust/initial-master/status" && request.status), "initial status response");
    const blurred = await state();
    assert.equal(blurred.displayed, "sondows");
    assert.equal(blurred.reactValue, "sondows");
    assert.ok(blurred.events.blur > 0, "blur must run");
    const initial = requests.find(request => request.path === "/api/admin-center/trust/initial-master/status");
    assert.equal(JSON.parse(initial.body).loginId, "sondows");
    assert.equal(initial.status, expectSetup ? 200 : 403);
    await until(() => initial.response, "initial status body");
    assert.equal(initial.response.available, expectSetup);
    if (expectSetup) {
      await until(() => evaluate('document.querySelector("dialog")?.open === true'),
        "authorized registration dialog");
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape",
        windowsVirtualKeyCode: 27 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape",
        windowsVirtualKeyCode: 27 });
      await until(() => evaluate('document.querySelector("dialog")?.open === false'),
        "registration dialog close");
    } else {
      assert.equal(await evaluate('document.querySelector("dialog")?.open'), false);
    }
    await evaluate("document.querySelector('input[autocomplete=\"username\"]').focus()");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter",
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter",
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    const entered = await state();
    assert.equal(entered.displayed, "sondows");
    assert.equal(entered.reactValue, "sondows");
    assert.ok(entered.events.enter > 0, "Enter key must run");
    await evaluate(`(() => {
      const input = document.querySelector('input[autocomplete="username"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, ""); input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      setter.call(input, "sondows"); input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    })()`);
    await until(async () => (await state())?.reactValue === "sondows", "synthetic autofill ID state");
    const filled = await state();
    assert.equal(filled.displayed, "sondows");
    assert.equal(filled.reactValue, "sondows");
    await evaluate(`(() => {
      const input = document.querySelector('input[autocomplete="username"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "unknownadm");
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    })()`);
    await until(async () => (await state())?.reactValue === "unknownadm", "changed React ID");
    await evaluate('document.querySelector(\'input[autocomplete="username"]\').blur()');
    await until(() => requests.some(request => request.path ===
      "/api/admin-center/trust/initial-master/status" &&
      request.body.includes("unknownadm") && request.status), "changed ID response");
    const changed = requests.find(request => request.path ===
      "/api/admin-center/trust/initial-master/status" && request.body.includes("unknownadm"));
    assert.equal(changed.status, expectSetup ? 200 : 403);
    await until(() => changed.response, "changed ID response body");
    assert.equal(changed.response.available, false);

    if (expectSetup) {
      await evaluate(`(() => {
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (url, options) => {
          const response = await originalFetch(url, options);
          if (String(url).includes("/initial-master/status") &&
            JSON.parse(options?.body ?? "{}").loginId === "sondows") {
            return new Promise(resolve => { window.__releaseOldStatus = () => resolve(response); });
          }
          return response;
        };
      })()`);
      await evaluate(`(() => {
        const input = document.querySelector('input[autocomplete="username"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "sondows"); input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        input.focus(); input.blur();
      })()`);
      await until(() => evaluate('typeof window.__releaseOldStatus === "function"'),
        "held old ID response");
      await evaluate(`(() => {
        const input = document.querySelector('input[autocomplete="username"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "unknownadm2"); input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        input.focus(); input.blur();
      })()`);
      await until(() => requests.some(request => request.path ===
        "/api/admin-center/trust/initial-master/status" &&
        request.body.includes("unknownadm2") && request.status), "latest ID response");
      await evaluate("window.__releaseOldStatus()");
      await delay(250);
      assert.equal(await evaluate('document.querySelector("dialog")?.open'), false,
        "old ID response must not open the registration dialog");
    }

    const beforePrefill = requests.length;
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
      window.__tdkSilentPrefill = false;
      document.addEventListener("DOMContentLoaded", () => {
        const observer = new MutationObserver(() => {
          const input = document.querySelector('input[autocomplete="username"]');
          if (!input || window.__tdkSilentPrefill) return;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          setter.call(input, "sondows");
          window.__tdkSilentPrefill = true;
          observer.disconnect();
        });
        observer.observe(document, { childList: true, subtree: true });
      }, { once: true });
    })()` });
    await send("Page.navigate", { url: origin + "/tdkadm/login" });
    await until(async () => (await state())?.reactValue === "sondows", "silent prefill React state");
    await until(() => requests.slice(beforePrefill).some(request => request.path ===
      "/api/admin-center/trust/initial-master/status" && request.body.includes("sondows") &&
      request.status), "silent prefill status response");
    const prefilled = requests.slice(beforePrefill).find(request => request.path ===
      "/api/admin-center/trust/initial-master/status" && request.body.includes("sondows"));
    assert.equal(prefilled.status, expectSetup ? 200 : 403);
    await until(() => prefilled.response, "silent prefill response body");
    assert.equal(prefilled.response.available, expectSetup);
    assert.equal(await evaluate("window.__tdkSilentPrefill"), true);
    if (expectSetup) {
      await until(() => evaluate('document.querySelector("dialog")?.open === true'),
        "prefilled authorized registration dialog");
    } else {
      assert.equal(await evaluate('document.querySelector("dialog")?.open'), false);
    }
    assert.equal(requests.some(request => request.method === "POST" &&
      request.path === "/api/program-trust/master-recovery/status"), false,
    "ordinary login must not call grant-gated recovery status");
    process.stdout.write(JSON.stringify({ id: "sondows", displayed: filled.displayed,
      reactState: filled.reactValue, events: filled.events, apiRequests: requests.map(({ method, path,
        status, response }) => ({ method, path, status, ...(response ? { response } : {}) })),
      recoveryStatusPost: false, browser: "pass", setupMode: expectSetup, mockStatus,
      silentPrefill: "pass", changedIdLookup: "pass",
      staleResponse: expectSetup ? "ignored" : "not-applicable" }) + "\n");
  } finally {
    if (socket) socket.close();
    if (browser) browser.kill();
    const safeRoot = await fs.realpath(os.tmpdir());
    const safeProfile = await fs.realpath(profile);
    if (!safeProfile.startsWith(safeRoot + path.sep) ||
      !path.basename(safeProfile).startsWith("tdk-adm-id-input-"))
      throw new Error("Unexpected Chrome profile location");
    await fs.rm(safeProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
}

main().catch(error => {
  console.error("ADM ID input check failed", { code: error.code ?? error.name, message: error.message });
  process.exitCode = 1;
});
