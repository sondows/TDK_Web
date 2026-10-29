import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { MANAGED_DEVICE_TYPES } from "./managed-device-types.ts";

const nativeRequire = createRequire(import.meta.url);
const schema = {
  managedDevices: Object.fromEntries(["deviceId", "deviceCode", "deviceName", "status", "requestExpiresAt", "expiresAt", "requestedAt", "approvedAt", "createdAt", "lastUsedAt", "revokedAt", "registeredByStaffId", "deviceType", "posEnabled", "admEnabled", "kdsEnabled", "hosEnabled", "confirmationCode", "requestTokenHash", "tokenHash"].map(key => [key, key])),
  staffSessions: { deviceId: "deviceId", managedDeviceId: "managedDeviceId", sessionType: "sessionType", status: "status" },
  adminSecuritySettings: { settingsId: "settingsId", deviceRegistrationPasswordEnabled: "enabled", deviceRegistrationPasswordHash: "passwordHash" },
  auditLogs: {},
};

function loadRoute(path, mocks) {
  const source = readFileSync(resolve(import.meta.dirname, path), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loadedModule = { exports: {} };
  runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports, Response, Request, Headers, console, Buffer,
    require: name => name in mocks ? mocks[name] : nativeRequire(name),
  }, { filename: path });
  return loadedModule.exports;
}

const drizzle = { and: (...parts) => parts, eq: (...parts) => parts, lte: (...parts) => parts, ne: (...parts) => parts };
const jsonResponse = { NextResponse: { json: (body, init) => {
  const response = Response.json(body, init);
  response.cookieWrites = [];
  response.cookies = { set: (...args) => response.cookieWrites.push(args) };
  return response;
} } };
const request = body => new Request("https://tdkon.myasustor.com/api/admin-center/devices", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("all four device types can submit registration requests without granting access", async () => {
  assert.deepEqual(MANAGED_DEVICE_TYPES, ["POS", "ADM", "KDS", "HOS"]);
  for (const deviceType of MANAGED_DEVICE_TYPES) {
    const inserts = [];
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ enabled: 0, passwordHash: null }] }) }) }),
      transaction: work => work({ insert: table => ({ values: async row => inserts.push({ table, row }) }) }),
    };
    const route = loadRoute("../app/api/kitchen/auth/device-request/route.ts", {
      crypto: { randomInt: () => 123456 }, "drizzle-orm": drizzle, "next/server": jsonResponse, "@/db": { db },
      "@/db/schema": schema,
      "@/lib/kds-device": { createKdsDeviceToken: () => "random-request-token", hashKdsDeviceToken: () => "request-hash",
        getCurrentDeviceRegistration: async () => null, isSameOriginRequest: () => true,
        kdsCookieSecureForRequest: () => true, kdsDeviceCookieOptions: { httpOnly: true, sameSite: "lax", path: "/" },
        KDS_DEVICE_COOKIE: "tdk_kds_device", KDS_DEVICE_MAX_AGE_SECONDS: 2592000,
        reserveKdsIpAttempt: async () => true },
      "@/lib/managed-device-types": { isManagedDeviceType: value => MANAGED_DEVICE_TYPES.includes(value) },
      "@/lib/auth": { verifySecurityPassword: async () => false },
    });
    const response = await route.POST(request({ deviceName: `${deviceType} tablet`, deviceType }));
    assert.equal(response.status, 200, deviceType);
    assert.equal(response.cookieWrites[0][0], "tdk_kds_device");
    assert.equal(response.cookieWrites[0][2].httpOnly, true);
    const stored = inserts.find(entry => entry.table === schema.managedDevices)?.row;
    assert.equal(stored?.deviceType, deviceType);
    assert.equal(stored?.status, "PENDING");
    assert.deepEqual([stored?.posEnabled, stored?.admEnabled, stored?.kdsEnabled, stored?.hosEnabled], [0, 0, 0, 0]);
  }
});

test("a pending registration cookie reuses its server request instead of inserting another", async () => {
  let transactions = 0;
  const route = loadRoute("../app/api/kitchen/auth/device-request/route.ts", {
    crypto: { randomInt: () => 123456 }, "next/server": jsonResponse,
    "@/db": { db: { transaction: async () => { transactions += 1; } } },
    "@/db/schema": schema,
    "@/lib/kds-device": { getCurrentDeviceRegistration: async () => ({ token: "existing-token", device: {
      status: "PENDING", confirmationCode: "654321", deviceName: "Existing tablet", deviceType: "KDS",
      requestExpiresAt: new Date(Date.now() + 600_000),
    } }), isSameOriginRequest: () => true },
    "@/lib/managed-device-types": { isManagedDeviceType: value => MANAGED_DEVICE_TYPES.includes(value) },
    "@/lib/auth": { verifySecurityPassword: async () => false },
  });
  const response = await route.POST(request({ deviceName: "Another tablet", deviceType: "KDS" }));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.confirmationCode, "654321");
  assert.equal(result.deviceName, "Existing tablet");
  assert.equal(transactions, 0);
});

function adminFixture({ deviceType = "KDS", status = "PENDING", deviceId = 7 } = {}) {
  const device = {
    deviceId, deviceCode: status === "APPROVED" ? `${deviceType}-${String(deviceId).padStart(3, "0")}` : null,
    deviceType, deviceName: "Original", status,
    requestExpiresAt: new Date(Date.now() + 600_000), requestTokenHash: "existing-token-hash",
    admEnabled: 0, hosEnabled: 0,
  };
  const changes = [];
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => ({ for: async () => [device] }) }) }) }),
    update: table => ({ set: patch => ({ where: async () => { changes.push({ table, patch }); Object.assign(device, table === schema.managedDevices ? patch : {}); } }) }),
    insert: () => ({ values: async () => {} }),
    delete: table => ({ where: async () => { changes.push({ table, deleted: true }); } }),
  };
  const route = loadRoute("../app/api/admin-center/devices/route.ts", {
    "drizzle-orm": drizzle, "@/db": { db: { transaction: work => work(tx) } }, "@/db/schema": schema,
    "@/lib/admin-auth": { requireAdminAccess: async () => null, requireOwnerSecurityAccess: async () => null, getCurrentAdminStaff: async () => ({ staffId: 1 }) },
    "@/lib/kds-device": { isSameOriginRequest: () => true },
    "@/lib/managed-device-types": {
      isManagedDeviceType: value => MANAGED_DEVICE_TYPES.includes(value),
      managedDeviceCode: (type, id) => `${type}-${String(id).padStart(3, "0")}`,
    },
  });
  return { route, device, changes };
}

const permissionsFor = type => ({
  posEnabled: type === "POS", admEnabled: type === "ADM",
  kdsEnabled: type === "KDS", hosEnabled: type === "HOS",
});

test("ADM approval issues each display code while retaining the request token hash", async () => {
  for (const deviceType of MANAGED_DEVICE_TYPES) {
    const fixture = adminFixture({ deviceType });
    const response = await fixture.route.POST(request({
      action: "approve", deviceId: 7, deviceName: "Approved", deviceType, ...permissionsFor(deviceType),
    }));
    assert.equal(response.status, 200, deviceType);
    assert.equal(fixture.device.deviceCode, `${deviceType}-007`);
    assert.equal(fixture.device.tokenHash, "existing-token-hash");
    assert.equal(fixture.device.status, "APPROVED");
  }
});

test("changing a registered device type updates its display code and permissions but not its token", async () => {
  const fixture = adminFixture({ status: "APPROVED", deviceType: "KDS" });
  const response = await fixture.route.POST(request({
    action: "update", deviceId: 7, deviceName: "Order tablet", deviceType: "HOS", ...permissionsFor("HOS"),
  }));
  assert.equal(response.status, 200);
  assert.equal(fixture.device.deviceCode, "HOS-007");
  assert.equal(fixture.device.hosEnabled, 1);
  assert.equal(fixture.device.kdsEnabled, 0);
  assert.equal(fixture.changes.some(change => change.table === schema.staffSessions), true);
  assert.equal(fixture.changes.find(change => change.table === schema.managedDevices)?.patch.tokenHash, undefined);
});

test("revoking a device blocks its registry row and ends attached non-admin sessions", async () => {
  const fixture = adminFixture({ status: "APPROVED", deviceType: "HOS" });
  const response = await fixture.route.POST(request({ action: "revoke", deviceId: 7 }));
  assert.equal(response.status, 200);
  assert.equal(fixture.device.status, "REVOKED");
  assert.equal(fixture.changes.some(change => change.table === schema.staffSessions), true);
});

test("deleting an approved HOS device removes its registry row", async () => {
  const fixture = adminFixture({ status: "APPROVED", deviceType: "HOS" });
  const response = await fixture.route.POST(request({ action: "delete", deviceId: 7 }));
  assert.equal(response.status, 200);
  assert.equal(fixture.changes.some(change => change.table === schema.managedDevices && change.deleted), true);
});

function deviceListFixture({ admin = true, devices = [], failure = null } = {}) {
  let listQueries = 0;
  const db = {
    update: () => ({ set: () => ({ where: async () => {} }) }),
    select: () => ({ from: () => ({ orderBy: async () => {
      listQueries += 1;
      if (failure) throw failure;
      return devices;
    } }) }),
  };
  const route = loadRoute("../app/api/admin-center/devices/route.ts", {
    "drizzle-orm": drizzle,
    "@/db": { db },
    "@/db/schema": schema,
    "@/lib/admin-auth": { requireAdminAccess: async () => null, requireOwnerSecurityAccess: async () => null, getCurrentAdminStaff: async () => admin ? { staffId: 1 } : null },
    "@/lib/kds-device": { isSameOriginRequest: () => true },
    "@/lib/managed-device-types": {
      isManagedDeviceType: value => MANAGED_DEVICE_TYPES.includes(value),
      managedDeviceCode: (type, id) => `${type}-${String(id).padStart(3, "0")}`,
    },
  });
  return { route, get listQueries() { return listQueries; } };
}

test("ADM device list returns existing rows for all supported types", async () => {
  const devices = MANAGED_DEVICE_TYPES.map((deviceType, deviceId) => ({
    deviceId: deviceId + 1, deviceCode: `${deviceType}-00${deviceId + 1}`, deviceName: `${deviceType} device`,
    deviceType, status: "APPROVED", posEnabled: 0, admEnabled: 0, kdsEnabled: 0, hosEnabled: 0,
  }));
  const fixture = deviceListFixture({ devices });
  const response = await fixture.route.GET();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).devices.map(device => device.deviceType), MANAGED_DEVICE_TYPES);
  assert.equal(fixture.listQueries, 1);
});

test("ADM device list returns a schema-specific error instead of an empty list", async () => {
  const fixture = deviceListFixture({ failure: Object.assign(new Error("unknown column"), { code: "ER_BAD_FIELD_ERROR" }) });
  const response = await fixture.route.GET();
  const result = await response.json();
  assert.equal(response.status, 503);
  assert.equal(result.success, false);
  assert.equal(result.code, "DEVICE_REGISTRY_SCHEMA_MISMATCH");
  assert.match(result.message, /managed_devices_add_adm_hos\.sql/);
  assert.equal(fixture.listQueries, 1);
});

test("ADM device list identifies missing base tables and database connection failures", async () => {
  for (const [errorCode, expectedCode] of [
    ["ER_NO_SUCH_TABLE", "DEVICE_REGISTRY_SCHEMA_MISMATCH"],
    ["ER_ACCESS_DENIED_ERROR", "DEVICE_REGISTRY_DB_UNAVAILABLE"],
  ]) {
    const response = await deviceListFixture({ failure: Object.assign(new Error("database error"), { code: errorCode }) }).route.GET();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, expectedCode);
  }
});

test("ADM device list tells apart the missing table, permission columns, and device enum", async () => {
  const cases = [
    [{ code: "ER_NO_SUCH_TABLE", sqlMessage: "Table 'TDK_POS_TEST.managed_devices' doesn't exist" }, "DEVICE_REGISTRY_TABLE_MISSING"],
    [{ code: "ER_BAD_FIELD_ERROR", sqlMessage: "Unknown column 'managed_devices.adm_enabled' in 'field list'" }, "DEVICE_REGISTRY_COLUMNS_MISSING"],
    [{ code: "WARN_DATA_TRUNCATED", sqlMessage: "Data truncated for column 'device_type' at row 1" }, "DEVICE_TYPE_ENUM_OUTDATED"],
  ];
  for (const [databaseError, expectedCode] of cases) {
    const response = await deviceListFixture({ failure: Object.assign(new Error("database schema error"), databaseError) }).route.GET();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, expectedCode);
  }
});

test("non-admin users cannot read or change the device registry", async () => {
  const fixture = deviceListFixture({ admin: false });
  const listResponse = await fixture.route.GET();
  assert.equal(listResponse.status, 401);
  assert.equal(fixture.listQueries, 0);
  const writeRoute = loadRoute("../app/api/admin-center/devices/route.ts", {
    "drizzle-orm": drizzle, "@/db": { db: {} }, "@/db/schema": schema,
    "@/lib/admin-auth": { requireAdminAccess: async () => Response.json({ success: false }, { status: 403 }), getCurrentAdminStaff: async () => null },
    "@/lib/kds-device": { isSameOriginRequest: () => true },
    "@/lib/managed-device-types": { isManagedDeviceType: value => MANAGED_DEVICE_TYPES.includes(value), managedDeviceCode: () => "" },
  });
  const writeResponse = await writeRoute.POST(request({ action: "deny", deviceId: 1 }));
  assert.equal(writeResponse.status, 403);
});
