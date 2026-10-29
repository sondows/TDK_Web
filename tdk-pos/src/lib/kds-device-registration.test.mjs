import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const deviceCookie = "tdk_kds_device";
const sessionCookie = "tdk_kds_session";
const schema = {
  managedDevices: { deviceId: "deviceId", deviceCode: "deviceCode", tokenHash: "tokenHash",
    requestTokenHash: "requestTokenHash", status: "status", expiresAt: "expiresAt" },
  staffSessions: { deviceId: "deviceId", managedDeviceId: "managedDeviceId", sessionTokenHash: "sessionTokenHash",
    sessionType: "sessionType", status: "status" },
  auditLogs: {},
};

function loadRoute(path, mocks) {
  const source = readFileSync(resolve(import.meta.dirname, path), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, {
    module, exports: module.exports, Response, Request, Headers, console, Buffer,
    require: name => name in mocks ? mocks[name] : nativeRequire(name),
  }, { filename: path });
  return module.exports;
}

function responseMock() {
  const setCookies = [];
  return { setCookies, nextServer: { NextResponse: { json: (body, init) => {
    const response = Response.json(body, init);
    response.cookies = { set: (...args) => setCookies.push(args) };
    return response;
  } } } };
}

function statusFixture(device, hasCookie = true, db = {}) {
  const responses = responseMock();
  const route = loadRoute("../app/api/kitchen/auth/device-request/status/route.ts", {
    "drizzle-orm": { and: () => true, eq: () => true, or: () => true },
    "next/headers": { cookies: async () => ({ has: () => hasCookie,
      get: name => name === deviceCookie && hasCookie ? { value: "d".repeat(43) } : undefined }) },
    "next/server": responses.nextServer, "@/db": { db }, "@/db/schema": schema,
    "@/lib/kds-device": { getCurrentDeviceRegistration: async () => device ? { device, token: "device-token" } : null,
      hashKdsDeviceToken: () => "device-hash", KDS_DEVICE_COOKIE: deviceCookie, KDS_DEVICE_MAX_AGE_SECONDS: 2592000,
      kdsCookieSecureForRequest: () => true, kdsDeviceCookieOptions: { path: "/", httpOnly: true },
      isSameOriginRequest: () => true },
  });
  return { route, ...responses };
}

test("registration status comes from the server, including pending and approved details", async () => {
  const request = new Request("https://tdkon.myasustor.com/api/kitchen/auth/device-request/status");
  const absent = statusFixture(null, false);
  assert.equal((await (await absent.route.GET(request)).json()).status, "UNREGISTERED");

  const pending = statusFixture({ status: "PENDING", deviceName: "Kitchen tablet", deviceType: "KDS",
    confirmationCode: "123456", requestExpiresAt: new Date(Date.now() + 600_000) });
  const pendingBody = await (await pending.route.GET(request)).json();
  assert.equal(pendingBody.status, "PENDING");
  assert.equal(pendingBody.confirmationCode, "123456");

  const approved = statusFixture({ status: "APPROVED", deviceName: "Order tablet", deviceType: "HOS",
    deviceCode: "HOS-007", expiresAt: new Date(Date.now() + 86_400_000) });
  const approvedBody = await (await approved.route.GET(request)).json();
  assert.equal(approvedBody.status, "APPROVED");
  assert.equal(approvedBody.deviceCode, "HOS-007");
  assert.equal(approvedBody.deviceName, "Order tablet");

  const revoked = statusFixture({ status: "REVOKED" });
  assert.equal((await (await revoked.route.GET(request)).json()).status, "UNREGISTERED");
  assert.equal(revoked.setCookies.find(([name]) => name === deviceCookie)?.[2].maxAge, 0);
});

test("pending request cancellation uses the HttpOnly cookie and clears it", async () => {
  const patches = [];
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => ({ for: async () => [{
      deviceId: 7, status: "PENDING", requestExpiresAt: new Date(Date.now() + 600_000),
    }] }) }) }) }),
    update: () => ({ set: patch => ({ where: async () => patches.push(patch) }) }),
  };
  const fixture = statusFixture(null, true, { transaction: work => work(tx) });
  const request = new Request("https://tdkon.myasustor.com/api/kitchen/auth/device-request/status", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }),
  });
  const response = await fixture.route.POST(request);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "CANCELLED");
  assert.equal(patches[0].status, "DENIED");
  assert.equal(fixture.setCookies.find(([name]) => name === deviceCookie)?.[2].maxAge, 0);
});

function revokeFixture({ approved = true, token = "device-token", originAllowed = true } = {}) {
  const responses = responseMock();
  const updates = [];
  const comparisons = [];
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => ({ for: async () => approved ? [{ deviceId: 7, deviceCode: "KDS-007" }] : [] }) }) }) }),
    update: table => ({ set: patch => ({ where: async () => updates.push({ table, patch }) }) }),
    insert: () => ({ values: async () => {} }),
  };
  const route = loadRoute("../app/api/kitchen/auth/device-request/revoke/route.ts", {
    "drizzle-orm": { and: (...args) => args, eq: (column, value) => { comparisons.push([column, value]); return true; },
      sql: () => true },
    "next/headers": { cookies: async () => ({ get: name => name === deviceCookie && token ? { value: token }
      : name === sessionCookie ? { value: "staff-session" } : undefined }) },
    "next/server": responses.nextServer, "@/db": { db: { transaction: work => work(tx) } }, "@/db/schema": schema,
    "@/lib/auth": { hashSessionToken: () => "staff-session-hash" },
    "@/lib/kds-auth": { KDS_SESSION_COOKIE_NAME: sessionCookie, kdsSessionCookieOptions: { path: "/", httpOnly: true } },
    "@/lib/kds-device": { hashKdsDeviceToken: () => "device-hash", isSameOriginRequest: () => originAllowed,
      KDS_DEVICE_COOKIE: deviceCookie, kdsCookieSecureForRequest: () => true,
      kdsDeviceCookieOptions: { path: "/", httpOnly: true } },
  });
  const request = new Request("https://tdkon.myasustor.com/api/kitchen/auth/device-request/revoke", { method: "POST" });
  return { route, request, updates, comparisons, ...responses };
}

test("self-revocation requires the approved device token and same-origin request", async () => {
  for (const settings of [{ token: "" }, { approved: false }, { originAllowed: false }]) {
    const fixture = revokeFixture(settings);
    const response = await fixture.route.POST(fixture.request);
    assert.equal(response.status, 403);
    assert.equal(fixture.updates.length, 0);
  }
});

test("self-revocation invalidates only the cookie-matched device and its KDS sessions", async () => {
  const fixture = revokeFixture();
  const response = await fixture.route.POST(fixture.request);
  assert.equal(response.status, 200);
  assert.equal(fixture.comparisons.some(([column, value]) => column === "tokenHash" && value === "device-hash"), true);
  assert.equal(fixture.updates.find(({ table }) => table === schema.managedDevices)?.patch.status, "REVOKED");
  assert.equal(fixture.updates.filter(({ table }) => table === schema.staffSessions).length, 2);
  assert.equal(fixture.setCookies.find(([name]) => name === deviceCookie)?.[2].maxAge, 0);
  assert.equal(fixture.setCookies.find(([name]) => name === sessionCookie)?.[2].maxAge, 0);
});
