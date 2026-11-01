/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const origin = process.argv[2] ?? "http://localhost:3000";
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sourcePath = path.resolve("src/components/ProgramTrustGate.tsx");
const originalText = "${program} 최초 인증";
const markerText = "${program} 최초 인증 [HMR-VERIFY]";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, label, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    try { const result = await check(); if (result) return result; }
    catch { /* Navigation or a refresh may replace the execution context. */ }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  const source = await fs.readFile(sourcePath, "utf8");
  if (source.split(originalText).length !== 2) throw new Error("Expected one stable source marker");
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "tdk-dev-hmr-"));
  let browser;
  let socket;
  let modified = false;
  let normalReloadFresh = false;
  const webSockets = [];
  const webSocketByRequest = new Map();
  const hmrHttpResponses = [];
  const consoleMessages = [];
  let evaluate;
  let send;
  try {
    browser = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-extensions",
      "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore", windowsHide: true });
    const port = await until(async () => {
      const content = await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8");
      return Number(content.split(/\r?\n/)[0]) || null;
    }, "Chrome debugging port");
    const page = await until(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      return (await response.json()).find(item => item.type === "page" && item.webSocketDebuggerUrl);
    }, "Chrome page");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      if (socket.readyState === WebSocket.OPEN) return resolve();
      const timer = setTimeout(() => reject(new Error("Chrome WebSocket open timeout")), 5000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", error => { clearTimeout(timer); reject(error); }, { once: true });
    });
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.method === "Network.webSocketCreated") {
        const record = { url: message.params.url, requestId: message.params.requestId };
        webSockets.push(record);
        webSocketByRequest.set(message.params.requestId, record);
      }
      if (message.method === "Network.webSocketHandshakeResponseReceived") {
        const target = webSocketByRequest.get(message.params.requestId);
        if (target) target.status = message.params.response.status;
      }
      if (message.method === "Network.webSocketClosed") {
        const target = webSocketByRequest.get(message.params.requestId);
        if (target) target.closed = true;
      }
      if (message.method === "Network.responseReceived" &&
          new URL(message.params.response.url).pathname === "/_next/hmr") {
        hmrHttpResponses.push({ status: message.params.response.status, url: message.params.response.url,
          type: message.params.type });
      }
      if (message.method === "Runtime.consoleAPICalled") {
        const text = message.params.args.map(arg => arg.value ?? "").join(" ");
        if (text.includes("HMR")) consoleMessages.push(text.slice(0, 180));
      }
      if (!message.id) return;
      const resolver = pending.get(message.id);
      if (!resolver) return;
      pending.delete(message.id);
      clearTimeout(resolver.timer);
      if (message.error) resolver.reject(new Error(message.error.message));
      else resolver.resolve(message.result);
    });
    send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome command timeout: ${method}`)); }, 6000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
    evaluate = async (expression, awaitPromise = false) => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
      if (result.exceptionDetails) throw new Error("Browser expression failed");
      return result.result.value;
    };

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Page.navigate", { url: `${origin}/tdkadm/login` });
    await until(() => evaluate("document.body?.innerText.includes('ADM 최초 인증')"), "ADM login screen");
    const workers = await evaluate("navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(items => items.length) : Promise.resolve(null)", true);
    const cachedPageKeys = await evaluate("globalThis.caches ? caches.keys().then(items => items) : Promise.resolve([])", true);
    await until(() => webSockets.some(item => item.url.includes("/_next/hmr")), "Next HMR WebSocket request");
    const connected = await until(() => consoleMessages.some(item => item.includes("[HMR] connected")),
      "Next HMR connected console event", 20).catch(() => false);

    await fs.writeFile(sourcePath, source.replace(originalText, markerText), "utf8");
    modified = true;
    await until(() => evaluate("document.body?.innerText.includes('ADM 최초 인증 [HMR-VERIFY]')"),
      "updated ADM screen after source change", 90);
    const changedUrl = await evaluate("location.pathname + location.search");
    assert.equal(changedUrl, "/tdkadm/login");

    process.stdout.write(JSON.stringify({ browser: "Chrome headless", hmrConnected: connected,
      hmrRequests: webSockets.map(({ url, status }) => ({ path: new URL(url).pathname,
        search: new URL(url).search, handshakeStatus: status ?? null })), hmrHttpResponses,
      sourceChanged: true, automaticRecompileAndRefresh: true, serviceWorkerRegistrations: workers,
      cacheNames: cachedPageKeys, pagePath: changedUrl, consoleMessages }) + "\n");
  } finally {
    if (modified) {
      await fs.writeFile(sourcePath, source, "utf8");
      if (evaluate) await until(() => evaluate("document.body?.innerText.includes('ADM 최초 인증') && !document.body?.innerText.includes('[HMR-VERIFY]')"),
        "restored source reflected in browser", 60).catch(() => {});
      if (send && evaluate) {
        await send("Page.reload");
        await until(() => evaluate("location.pathname === '/tdkadm/login' && document.body?.innerText.includes('ADM 최초 인증') && !document.body?.innerText.includes('[HMR-VERIFY]')"),
          "ordinary reload displays restored source", 60).then(() => { normalReloadFresh = true; }).catch(() => {});
      }
    }
    if (socket) socket.close();
    if (browser) browser.kill();
    const safeRoot = await fs.realpath(os.tmpdir());
    const safeProfile = await fs.realpath(profile);
    if (!safeProfile.startsWith(safeRoot + path.sep) || !path.basename(safeProfile).startsWith("tdk-dev-hmr-"))
      throw new Error("Unexpected Chrome profile location");
    await fs.rm(safeProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    process.stdout.write(JSON.stringify({ sourceRestored: !modified ||
      !(await fs.readFile(sourcePath, "utf8")).includes("[HMR-VERIFY]"), ordinaryReloadFresh: normalReloadFresh,
      origin }) + "\n");
  }
}

main().catch(error => {
  console.error("Development HMR check failed", { code: error.code ?? error.name, message: error.message });
  process.exitCode = 1;
});
