import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);

function createFixture({ staffId, role = "OWNER", ownerStaffId = 1, actorStaffId = ownerStaffId, changes = {} }) {
  const staff = Object.fromEntries([
    "staffId", "staffCode", "name", "role", "isActive", "posEnabled", "hosEnabled", "employeePinHash",
    "kdsEnabled", "kdsPasswordHash", "kdsTotpSecretEnc", "kdsPinChangeRequired", "adminLoginId", "adminEnabled",
  ].map(column => [column, column]));
  const adminSecurityOwners = { staffId: "staffId" };
  const programTrustTokens = { tokenId: "tokenId", enrolledByStaffId: "enrolledByStaffId", program: "program" };
  const target = {
    staffId, staffCode: `AUTO-${staffId}`, name: "Test Employee", role, isActive: 1, posEnabled: 1, hosEnabled: 0,
    employeePinHash: "existing-hash", kdsEnabled: 0, kdsPasswordHash: null,
    kdsTotpSecretEnc: null, kdsPinChangeRequired: 0, adminLoginId: `staff${staffId}`,
    adminEnabled: 1,
  };
  const updates = [];
  let staffSelectCount = 0;
  const tx = {
    select: () => {
      let table;
      const query = {
        from(value) { table = value; return this; },
        where() { return this; },
        limit() { return this; },
        for() { staffSelectCount += 1; return Promise.resolve([target]); },
        then(resolve, reject) {
          const result = table === programTrustTokens ? [] : table === adminSecurityOwners ? (target.staffId === ownerStaffId ? [{ staffId: ownerStaffId }] : []) :
            table === staff && staffSelectCount++ > 0 ? [] : [target];
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
    update: () => ({ set: values => { updates.push(values); return { where: async () => {} }; } }),
    insert: () => ({ values: async () => {} }),
  };
  const db = { transaction: callback => callback(tx) };
  const source = readFileSync(resolve(import.meta.dirname, "../app/api/admin-center/staff/[staffId]/route.ts"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  runInNewContext(code, {
    module: loaded, exports: loaded.exports, Response, Request, console,
    require: name => {
      if (name === "drizzle-orm") return { and: (...values) => values, eq: (...values) => values, ne: (...values) => values, isNull: value => value, sql: () => ({}) };
      if (name === "@/db") return { db };
      if (name === "@/db/schema") return { adminSecurityOwners, auditLogs: {}, programTrustTokens, staff, staffSessions: { staffId: "staffId", sessionType: "sessionType", status: "status" } };
      if (name === "@/lib/admin-auth") return { getCurrentAdminStaff: async () => ({ staffId: actorStaffId }), requireAdminAccess: async () => null, requireOwnerSecurityAccess: async () => null };
      if (name === "@/lib/auth") return { hashEmployeePin: async () => "new-hash" };
      if (name === "@/lib/kds-device") return { isSameOriginRequest: () => true };
      if (name === "@/lib/staff-management-server") return {
        hasHosStaffPermissionColumn: async () => true,
        isDuplicateAdminLoginId: () => false,
        parseStaffDraft: body => ({ valid: true, errors: {}, draft: body }),
        staffColumns: {}, staffColumnsWithoutHos: {}, toStaffSummary: value => value,
      };
      return nativeRequire(name);
    },
  });
  const body = {
    name: target.name, loginId: target.adminLoginId, role: target.role, isActive: true, posEnabled: true,
    kdsEnabled: true, hosEnabled: false, employeePin: "", employeePinConfirm: "", adminEnabled: true,
    ...changes,
  };
  const request = new Request("https://tdkon.myasustor.com/api/admin-center/staff/2", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { patch: () => loaded.exports.PATCH(request, { params: Promise.resolve({ staffId: String(staffId) }) }), updates };
}

function loadStaffSummaryHelper() {
  const source = readFileSync(resolve(import.meta.dirname, "./staff-management-server.ts"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  runInNewContext(code, {
    module: loaded, exports: loaded.exports,
    require: name => name === "server-only" ? {} : name === "@/db" ? { pool: {} } : name === "@/db/schema" ? { staff: {} } :
      name === "@/lib/staff-management" ? { validateStaffDraft: () => ({}) } : nativeRequire(name),
  });
  return loaded.exports;
}

test("a second employee with legacy OWNER role can have KDS access saved", async () => {
  const fixture = createFixture({ staffId: 2, ownerStaffId: 1 });
  const response = await fixture.patch();
  assert.equal(response.status, 200);
  assert.equal(fixture.updates[0].kdsEnabled, 1);
  assert.equal(fixture.updates[0].role, "OWNER");
});

test("the designated owner can save own POS, KDS, and HOS permissions", async () => {
  const fixture = createFixture({ staffId: 1, changes: { posEnabled: false, hosEnabled: true } });
  const response = await fixture.patch();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reauthRequired, false);
  assert.equal(fixture.updates[0].posEnabled, 0);
  assert.equal(fixture.updates[0].kdsEnabled, 1);
  assert.equal(fixture.updates[0].hosEnabled, 1);
  assert.equal(fixture.updates[0].role, "OWNER");
  assert.equal(fixture.updates[0].adminEnabled, 1);
  assert.equal(fixture.updates[0].adminEnabled, 1);
});

test("the designated owner can change own name and login ID while PIN remains employee-managed", async () => {
  const fixture = createFixture({ staffId: 1, changes: {
    name: "Updated Owner", loginId: "newowner", employeePin: "012345", employeePinConfirm: "012345",
  } });
  const response = await fixture.patch();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reauthRequired, true);
  assert.equal(fixture.updates[0].name, "Updated Owner");
  assert.equal(fixture.updates[0].adminLoginId, "newowner");
  assert.equal(fixture.updates[0].employeePinHash, undefined);
});

test("the designated owner cannot be disabled or lose ADM access", async () => {
  for (const changes of [{ isActive: false }, { adminEnabled: false }]) {
    const fixture = createFixture({ staffId: 1, changes });
    const response = await fixture.patch();
    assert.equal(response.status, 403);
    assert.equal(fixture.updates.length, 0);
  }
});

test("another employee cannot edit the designated owner or acquire OWNER role", async () => {
  const otherActor = createFixture({ staffId: 1, actorStaffId: 2 });
  assert.equal((await otherActor.patch()).status, 403);
  assert.equal(otherActor.updates.length, 0);
  const promotion = createFixture({ staffId: 2, role: "STAFF", changes: { role: "OWNER" } });
  assert.equal((await promotion.patch()).status, 403);
  assert.equal(promotion.updates.length, 0);
});

test("staff list reflects the stored KDS permission even when a PIN is not configured", () => {
  const { toStaffSummary } = loadStaffSummaryHelper();
  const summary = toStaffSummary({
    staffId: 9, staffCode: "AUTO-9", name: "Test Employee", role: "STAFF", isActive: 1, posEnabled: 1,
    hosEnabled: 0, employeePinHash: null, kdsEnabled: 1,
    kdsPasswordHash: null, kdsTotpSecretEnc: null, kdsPinChangeRequired: 1,
    adminLoginId: "staff9", adminEnabled: 0,
  });
  assert.equal(summary.kdsEnabled, true);
  assert.equal(summary.hasEmployeePin, false);
  assert.equal("hasLegacyPosPin" in summary, false);
  assert.equal("hasKdsPin" in summary, false);
  assert.equal("hasLegacyAdminPin" in summary, false);
});
