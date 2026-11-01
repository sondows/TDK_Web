import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);

function loadRoute() {
  const source = readFileSync(resolve(import.meta.dirname, "staff/[staffId]/security-password/route.ts"), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const tables = {
    staff: { staffId: "staff_id", staffCode: "staff_code", isActive: "is_active", terminatedAt: "terminated_at" },
    programTrustTokens: { enrolledByStaffId: "enrolled_by_staff_id", revokedAt: "revoked_at" },
    staffSessions: { staffId: "staff_id", status: "status" },
    auditLogs: {},
  };
  const updates = [], inserts = [];
  const target = { staffId: 42 };
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => ({ for: async () => [target] }) }),
      }),
    }),
    update: table => ({
      set: values => ({ where: async () => { updates.push({ table, values }); } }),
    }),
    insert: table => ({ values: async values => { inserts.push({ table, values }); } }),
  };
  const db = { transaction: async callback => callback(tx) };
  const loaded = { exports: {} };
  runInNewContext(code, {
    module: loaded,
    exports: loaded.exports,
    Request,
    Response,
    Number,
    Date,
    console,
    require: name => name === "drizzle-orm" ? {
      and: (...values) => values, eq: (...values) => values, isNull: value => value, ne: (...values) => values,
    } : name === "@/db" ? { db }
      : name === "@/db/schema" ? tables
        : name === "@/lib/admin-auth" ? {
          getCurrentAdminStaff: async () => ({ staffId: 7 }), requireOwnerSecurityAccess: async () => null,
        } : name === "@/lib/kds-device" ? { isHttpsSameOriginRequest: () => true }
          : nativeRequire(name),
  });
  return { post: loaded.exports.POST, updates, inserts, tables };
}

test("credential reset clears only shared credentials while revoking tokens, sessions and auditing", async () => {
  const { post, updates, inserts, tables } = loadRoute();
  const request = new Request("https://tdkon.example/api/admin-center/staff/42/security-password", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }),
  });
  const response = await post(request, { params: Promise.resolve({ staffId: "42" }) });
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(updates[0].values).sort(), [
    "employeePinHash", "kdsPinChangeRequired", "securityPasswordChangeRequired", "securityPasswordHash", "updatedAt",
  ].sort());
  assert.equal(updates[0].values.employeePinHash, null);
  assert.equal(updates[0].values.securityPasswordHash, null);
  assert.equal(updates[1].table, tables.programTrustTokens);
  assert.equal(updates[2].table, tables.staffSessions);
  assert.equal(inserts[0].table, tables.auditLogs);
});
