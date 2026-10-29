import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as hostAccess from "./host-access.ts";
import { canUseKdsSessionOnNetwork, isTrustedPosNetwork } from "./kds-network.ts";

const nativeRequire = createRequire(import.meta.url);
function loadRoute(path, mocks, globals = {}) {
  const source = readFileSync(resolve(import.meta.dirname, path), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loadedModule = { exports: {} };
  runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, console, Response, Request, Headers, URL, Buffer,
    require: name => name in mocks ? mocks[name] : nativeRequire(name),
    ...globals,
  }, { filename: path });
  return loadedModule.exports;
}

function loginFixture({ internal, device = null, employeeId = "staff9", adminLoginId = null, candidateRows = null,
  ipAllowed = true, attemptAllowed = true, failureAllowed = true, candidate = {
  staffId: 9, employeePinHash: "stored-hash", isActive: 1, kdsEnabled: 1, kdsPinChangeRequired: 0,
} }) {
  const rows = [], cookies = [], failedAttempts = [], clearedAttempts = [];
  const staff = { staffCode: "staff_code", adminLoginId: "admin_login_id" };
  const staffSessions = { name: "staff_sessions", managedDeviceId: "managed_device_id" };
  const db = {
    select: () => ({ from: () => ({ where: condition => ({ limit: async () => {
      const matches = clause => clause.column === staff.adminLoginId ? clause.value === (adminLoginId ?? employeeId.toLowerCase()) : false;
      return matches(condition) ? candidateRows ?? (candidate ? [candidate] : []) : [];
    } }) }) }),
    insert: table => ({ values: async row => { rows.push({ table, row }); } }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };
  const route = loadRoute("../app/api/kitchen/auth/login/route.ts", {
    "drizzle-orm": { eq: (column, value) => ({ column, value }), sql: (_parts, _column, value) => ({ column: staff.adminLoginId, value }) },
    "next/server": { NextResponse: { json: (body, init) => {
      const response = Response.json(body, init);
      response.cookies = { set: (...args) => cookies.push(args) };
      return response;
    } } },
    "@/db": { db },
    "@/db/schema": { auditLogs: {}, managedDevices: {}, staff, staffSessions },
    "@/lib/auth": { createSessionToken: () => "employee-session", hashSessionToken: () => "session-hash", verifyEmployeePin: async pin => pin === "123456" },
    "@/lib/kds-login-limit": {
      clearKdsLoginAttempts: async staffId => { clearedAttempts.push(staffId); },
      isKdsLoginAttemptAllowed: async () => attemptAllowed,
      recordKdsLoginFailure: async (staffId, id) => { failedAttempts.push({ staffId, employeeId: id }); return failureAllowed; },
    },
    "@/lib/kds-auth": { KDS_SESSION_COOKIE_NAME: "tdk_kds_session", kdsSessionCookieOptions: { httpOnly: true, sameSite: "lax" } },
    "@/lib/kds-device": { getCurrentKdsDevice: async () => device, kdsCookieSecureForRequest: () => true,
      reserveKdsIpAttempt: async () => ipAllowed, isSameOriginRequest: () => true },
    "@/lib/kds-network-server": { getKdsNetworkContext: async () => ({ isInternal: internal, clientIp: internal ? "192.168.0.54" : "198.51.100.20" }) },
    "@/lib/kds-auth-errors": { getKdsAuthSchemaError: () => null, getKdsForeignKeyViolation: () => null },
  });
  const login = pin => route.POST(new Request("https://tdkon.myasustor.com/api/kitchen/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://tdkon.myasustor.com" },
    body: JSON.stringify({ loginId: employeeId, pin }),
  }));
  return { login, rows, cookies, staffSessions, failedAttempts, clearedAttempts };
}

test("LAN login still requires a valid employee PIN", async () => {
  const fixture = loginFixture({ internal: true });
  const response = await fixture.login("000000");
  assert.equal(response.status, 401);
  assert.equal(fixture.rows.some(entry => entry.table === fixture.staffSessions), false);
});

test("a new LAN browser signs in without a device token", async () => {
  const fixture = loginFixture({ internal: true });
  const response = await fixture.login("123456");
  assert.equal(response.status, 200);
  assert.equal(fixture.rows.find(entry => entry.table === fixture.staffSessions)?.row.managedDeviceId, null);
  assert.equal(fixture.cookies[0][0], "tdk_kds_session");
  assert.deepEqual(fixture.failedAttempts, []);
  assert.deepEqual(fixture.clearedAttempts, [9]);
});

test("KDS enabled and active flags accept numeric database representations", async () => {
  const fixture = loginFixture({ internal: true, candidate: {
    staffId: 9, employeePinHash: "stored-hash", isActive: "1", kdsEnabled: "1", kdsPinChangeRequired: 0,
  } });
  assert.equal((await fixture.login("123456")).status, 200);
});

test("inactive employees receive the same generic credential denial", async () => {
  const fixture = loginFixture({ internal: true, candidate: {
    staffId: 9, employeePinHash: "stored-hash", isActive: 0, kdsEnabled: 1, kdsPinChangeRequired: 0,
  } });
  const response = await fixture.login("123456");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, undefined);
  assert.equal(fixture.rows.some(entry => entry.table === fixture.staffSessions), false);
});

test("only incorrect credentials consume the per-employee login-failure limit", async () => {
  const wrongPin = loginFixture({ internal: true });
  assert.equal((await wrongPin.login("000000")).status, 401);
  assert.deepEqual(wrongPin.failedAttempts, [{ staffId: 9, employeeId: "staff9" }]);

  const noPermission = loginFixture({ internal: true, candidate: {
    staffId: 9, employeePinHash: "stored-hash", isActive: 1, kdsEnabled: 0, kdsPinChangeRequired: 0,
  } });
  assert.equal((await noPermission.login("123456")).status, 403);
  assert.deepEqual(noPermission.failedAttempts, []);

  const wrongPinWithoutPermission = loginFixture({ internal: true, candidate: {
    staffId: 9, employeePinHash: "stored-hash", isActive: 1, kdsEnabled: 0, kdsPinChangeRequired: 0,
  } });
  const wrongPinResponse = await wrongPinWithoutPermission.login("000000");
  assert.equal(wrongPinResponse.status, 401);
  assert.equal((await wrongPinResponse.json()).code, undefined);
  assert.deepEqual(wrongPinWithoutPermission.failedAttempts, [{ staffId: 9, employeeId: "staff9" }]);

  const unapprovedDevice = loginFixture({ internal: false });
  assert.equal((await unapprovedDevice.login("123456")).status, 403);
  assert.deepEqual(unapprovedDevice.failedAttempts, []);
  assert.deepEqual(unapprovedDevice.clearedAttempts, [9]);
});

test("a locked employee is rejected before PIN verification", async () => {
  const fixture = loginFixture({ internal: true, attemptAllowed: false });
  const response = await fixture.login("123456");
  assert.equal(response.status, 429);
  assert.deepEqual(fixture.failedAttempts, []);
  assert.equal(fixture.rows.some(entry => entry.table === fixture.staffSessions), false);
});

test("IP and employee rate limits return distinct machine-readable codes", async () => {
  const byIp = loginFixture({ internal: true, ipAllowed: false });
  const ipResponse = await byIp.login("123456");
  assert.equal(ipResponse.status, 429);
  assert.equal((await ipResponse.json()).code, "KDS_IP_RATE_LIMIT");

  const byEmployee = loginFixture({ internal: true, attemptAllowed: false });
  const employeeResponse = await byEmployee.login("123456");
  assert.equal(employeeResponse.status, 429);
  assert.equal((await employeeResponse.json()).code, "KDS_EMPLOYEE_RATE_LIMIT");
});

test("an existing admin login ID resolves to its staff account for KDS login", async () => {
  const fixture = loginFixture({ internal: true, employeeId: "MANAGER", staffCode: "AUTO-0123456789abcdef", adminLoginId: "manager" });
  const response = await fixture.login("123456");
  assert.equal(response.status, 200);
  assert.equal(fixture.rows.find(entry => entry.table === fixture.staffSessions)?.row.staffId, 9);
  assert.equal(fixture.cookies[0][0], "tdk_kds_session");
});

test("a 32-character admin ID works on an approved external device", async () => {
  const id = "a".repeat(32);
  const fixture = loginFixture({ internal: false, device: { deviceId: 12 }, employeeId: id,
    staffCode: "AUTO-0123456789abcdef", adminLoginId: id });
  const response = await fixture.login("123456");
  assert.equal(response.status, 200);
  assert.equal(fixture.rows.find(entry => entry.table === fixture.staffSessions)?.row.managedDeviceId, 12);
});

test("an admin login ID still requires the correct KDS PIN and KDS permission", async () => {
  const identity = { internal: true, employeeId: "manager", staffCode: "AUTO-0123456789abcdef", adminLoginId: "manager" };
  const wrongPin = loginFixture(identity);
  assert.equal((await wrongPin.login("000000")).status, 401);
  assert.equal(wrongPin.rows.some(entry => entry.table === wrongPin.staffSessions), false);
  const noPermission = loginFixture({ ...identity, candidate: {
    staffId: 9, employeePinHash: "stored-hash", isActive: 1, kdsEnabled: 0, kdsPinChangeRequired: 0,
  } });
  const denied = await noPermission.login("123456");
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "KDS_PERMISSION_DENIED");
  assert.equal(noPermission.rows.some(entry => entry.table === noPermission.staffSessions), false);
  const noPin = loginFixture({ ...identity, candidate: {
    staffId: 9, employeePinHash: null, isActive: 1, kdsEnabled: 1, kdsPinChangeRequired: 0,
  } });
  const notConfigured = await noPin.login("123456");
  assert.equal(notConfigured.status, 401);
  assert.equal((await notConfigured.json()).code, undefined);
  assert.deepEqual(noPin.failedAttempts, [{ staffId: 9, employeeId: "manager" }]);
  assert.equal(noPin.rows.some(entry => entry.table === noPin.staffSessions), false);
});

test("ambiguous ID matches never select a different employee account", async () => {
  const candidate = { staffId: 9, employeePinHash: "stored-hash", isActive: 1, kdsEnabled: 1, kdsPinChangeRequired: 0 };
  const fixture = loginFixture({ internal: true, candidateRows: [candidate, { ...candidate, staffId: 10 }] });
  const response = await fixture.login("123456");
  assert.equal(response.status, 401);
  assert.equal(fixture.rows.some(entry => entry.table === fixture.staffSessions), false);
});

test("KDS PIN hashes verify only the matching six-digit PIN", async () => {
  const auth = loadRoute("auth.ts", {
    "server-only": {}, "next/headers": { cookies: async () => ({ get: () => null }) },
    "drizzle-orm": { and: () => true, eq: () => true, gt: () => true },
    "@/db": { db: {} }, "@/db/schema": { staff: {}, staffSessions: {} },
    "@/lib/pin": { isValidPin: () => true },
  }, { process: { env: { NODE_ENV: "test" } } });
  const hash = await auth.hashKdsPin("123456");
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await auth.verifyKdsPin("123456", hash), true);
  assert.equal(await auth.verifyKdsPin("654321", hash), false);
  assert.equal(await auth.verifyKdsPin("12345", hash), false);
  const leadingZeroHash = await auth.hashKdsPin("012345");
  assert.equal(await auth.verifyKdsPin("012345", leadingZeroHash), true);
  assert.equal(await auth.verifyKdsPin("12345", leadingZeroHash), false);
});

test("a registered LAN browser binds its staff session to the approved device", async () => {
  const fixture = loginFixture({ internal: true, device: { deviceId: 12 } });
  const response = await fixture.login("123456");
  assert.equal(response.status, 200);
  assert.equal(fixture.rows.find(entry => entry.table === fixture.staffSessions)?.row.managedDeviceId, 12);
});

test("an unregistered external browser is sent to device registration", async () => {
  const fixture = loginFixture({ internal: false });
  const response = await fixture.login("123456");
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "DEVICE_APPROVAL_REQUIRED");
  assert.equal(fixture.rows.some(entry => entry.table === fixture.staffSessions), false);
});

test("an approved external browser signs in with a session bound to its device", async () => {
  const fixture = loginFixture({ internal: false, device: { deviceId: 12 } });
  const response = await fixture.login("123456");
  assert.equal(response.status, 200);
  assert.equal(fixture.rows.find(entry => entry.table === fixture.staffSessions)?.row.managedDeviceId, 12);
});

function sessionFixture({ internal, boundDeviceId, approvedDeviceId }) {
  const member = { staffId: 9, staffCode: "9", name: "Cook", kdsPinChangeRequired: 0, managedDeviceId: boundDeviceId };
  const route = loadRoute("kds-auth.ts", {
    "server-only": {}, "drizzle-orm": { and: () => true, eq: () => true, gt: () => true },
    "next/headers": { cookies: async () => ({ get: () => ({ value: "employee-session" }) }) },
    "@/db": { db: { select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [member] }) }) }) }) } },
    "@/db/schema": { staff: {}, staffSessions: {} },
    "@/lib/auth": { hashSessionToken: () => "session-hash", sessionCookieSecure: true, SESSION_MAX_AGE_SECONDS: 43200 },
    "@/lib/kds-device": { getCurrentKdsDevice: async () => approvedDeviceId === null ? null : { deviceId: approvedDeviceId } },
    "@/lib/kds-network": { canUseKdsSessionOnNetwork },
    "@/lib/kds-network-server": { getKdsNetworkContext: async () => ({ isInternal: internal }) },
  });
  return route.getCurrentKdsStaff();
}

test("LAN session loses API access after moving outside without device registration", async () => {
  assert.equal((await sessionFixture({ internal: true, boundDeviceId: null, approvedDeviceId: null }))?.staffId, 9);
  assert.equal(await sessionFixture({ internal: false, boundDeviceId: null, approvedDeviceId: null }), null);
  assert.equal(await sessionFixture({ internal: false, boundDeviceId: 12, approvedDeviceId: null }), null);
  assert.equal((await sessionFixture({ internal: false, boundDeviceId: 12, approvedDeviceId: 12 }))?.staffId, 9);
});

test("the public POS route rejects a browser-supplied network marker", () => {
  class ProxyResponse extends Response {
    static rewrite() { return new Response(null, { status: 209 }); }
    static next() { return new Response(null, { status: 208 }); }
    static redirect() { return new Response(null, { status: 207 }); }
  }
  const route = loadRoute("../proxy.ts", {
    "next/server": { NextResponse: ProxyResponse },
    "@/lib/host-access": hostAccess,
    "@/lib/kds-network": { isTrustedPosNetwork },
  }, { process: { env: { KDS_PROXY_SHARED_SECRET: "a".repeat(64), KDS_INTERNAL_CIDRS: "192.168.0.0/24" } } });
  const request = headers => ({
    headers: new Headers({ host: "tdkon.myasustor.com", "x-tdk-trusted-network": "caddy-vpn-validated", ...headers }),
    nextUrl: { pathname: "/tdkpos", search: "" },
    url: "https://tdkon.myasustor.com/tdkpos", method: "GET",
  });
  assert.equal(route.proxy(request({})).status, 403);
  assert.equal(route.proxy(request({ "x-tdk-kds-proxy-secret": "a".repeat(64), "x-tdk-kds-client-ip": "198.51.100.30" })).status, 403);
  assert.equal(route.proxy(request({ "x-tdk-kds-proxy-secret": "a".repeat(64), "x-tdk-kds-client-ip": "192.168.0.54" })).status, 209);
});

test("LAN aliases render existing routes and legacy page paths redirect without opening public POS", () => {
  class ProxyResponse extends Response {
    static rewrite(target, options) {
      return new Response(null, { status: 209, headers: {
        location: target.toString(), surface: options.request.headers.get("x-tdk-external-surface") ?? "",
      } });
    }
    static next() { return new Response(null, { status: 208 }); }
    static redirect(target) { return new Response(null, { status: 307, headers: { location: target.toString() } }); }
  }
  const route = loadRoute("../proxy.ts", {
    "next/server": { NextResponse: ProxyResponse },
    "@/lib/host-access": hostAccess,
    "@/lib/kds-network": { isTrustedPosNetwork },
  }, { process: { env: { KDS_PROXY_SHARED_SECRET: "a".repeat(64), KDS_INTERNAL_CIDRS: "192.168.0.0/24" } } });
  const request = (host, pathname) => ({
    headers: new Headers({ host }), nextUrl: { pathname, search: "?example=1" },
    url: `http://${host}${pathname}?example=1`, method: "GET",
  });
  const pos = route.proxy(request("192.168.0.83:3000", "/tdkpos"));
  assert.equal(pos.status, 209);
  assert.equal(pos.headers.get("location"), "http://192.168.0.83:3000/pos?example=1");
  assert.equal(pos.headers.get("surface"), "pos");
  const kds = route.proxy(request("192.168.0.83:3000", "/tdkkds"));
  assert.equal(kds.status, 209);
  assert.equal(kds.headers.get("location"), "http://192.168.0.83:3000/kitchen?example=1");
  assert.equal(kds.headers.get("surface"), "kds");
  assert.equal(route.proxy(request("192.168.0.83:3000", "/pos")).headers.get("location"),
    "http://192.168.0.83:3000/tdkpos?example=1");
  assert.equal(route.proxy(request("192.168.0.83:3000", "/kitchen")).headers.get("location"),
    "http://192.168.0.83:3000/tdkkds?example=1");
  assert.equal(route.proxy(request("tdkon.myasustor.com", "/pos")).status, 403);
  assert.equal(route.proxy(request("tdkon.myasustor.com", "/tdkpos")).status, 403);
  assert.equal(route.proxy(request("tdkon.myasustor.com", "/kitchen")).headers.get("location"),
    "http://tdkon.myasustor.com/tdkkds?example=1");
  assert.equal(route.proxy(request("192.168.0.83:3000", "/tdkpos/manifest.webmanifest")).status, 208);
  assert.equal(route.proxy(request("192.168.0.83:3000", "/tdkkds/kds.webmanifest")).status, 208);
  assert.equal(route.proxy(request("tdkon.myasustor.com", "/tdkpos/manifest.webmanifest")).status, 403);
  assert.equal(route.proxy(request("tdkon.myasustor.com", "/tdkkds/kds.webmanifest")).status, 208);
  assert.equal(route.proxy(request("192.168.0.83:3000", "/")).headers.get("location"),
    "http://192.168.0.83:3000/tdkadm?example=1");
  assert.equal(route.proxy(request("192.168.0.83:3000", "/tdkadm")).headers.get("location"),
    "http://192.168.0.83:3000/admin?example=1");
  assert.equal(route.proxy(request("192.168.0.83:3000", "/admin/security/devices")).headers.get("location"),
    "http://192.168.0.83:3000/tdkadm/security/devices?example=1");
  assert.equal(route.proxy(request("tdkon.myasustor.com", "/admin/login")).headers.get("location"),
    "http://tdkon.myasustor.com/tdkadm/login?example=1");
  assert.equal(route.proxy(request("tdkon.myasustor.com", "/tdkadm/security/devices")).headers.get("location"),
    "http://tdkon.myasustor.com/admin/security/devices?example=1");
  assert.equal(route.proxy(request("tdkon.myasustor.com", "/tdkadm/manifest.webmanifest")).status, 208);
});
