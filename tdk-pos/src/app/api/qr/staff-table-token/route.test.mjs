import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);

function loadRoute(state = {}) {
  const source = readFileSync(resolve(import.meta.dirname, "route.ts"), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const tables = Object.fromEntries(["auditLogs", "diningTables", "qrOrders", "qrSessionInvites", "qrSessions", "tableSessions"]
    .map(name => [name, Object.fromEntries(["tableId", "sessionId", "qrSessionId", "qrOrderId", "status", "revokedAt", "isActive"].map(key => [key, `${name}.${key}`]))]));
  const audit = [];
  const updates = [];
  const calls = { pos: 0, hos: 0 };
  const rows = table => {
    if (table === tables.diningTables) return state.table === false ? [] : [{ tableId: 1, isActive: 1 }];
    if (table === tables.tableSessions) return state.tableSessions ?? [{ sessionId: 10 }];
    if (table === tables.qrSessions) return state.qrSessions ?? [{ qrSessionId: 20, status: "ACTIVE" }];
    if (table === tables.qrOrders) return state.pending ? [{ qrOrderId: 30 }] : [];
    throw new Error("Unexpected select table");
  };
  const tx = {
    select: () => ({ from: table => {
      const query = {
        where: () => query,
        for: () => query,
        limit: async () => rows(table),
        then: (resolve, reject) => Promise.resolve(rows(table)).then(resolve, reject),
      };
      return query;
    } }),
    update: table => ({ set: values => ({ where: async () => { updates.push({ table, values }); } }) }),
    insert: table => ({ values: async values => {
      assert.equal(table, tables.auditLogs);
      audit.push(values);
    } }),
  };
  const db = { transaction: async callback => callback(tx) };
  const loaded = { exports: {} };
  runInNewContext(code, {
    module: loaded, exports: loaded.exports, Request, Response, Number, Date, console,
    require: name => name === "drizzle-orm" ? {
      and: (...values) => values, eq: (...values) => values, inArray: (...values) => values,
      isNull: value => value, or: (...values) => values,
    } : name === "@/db" ? { db }
      : name === "@/db/schema" ? tables
        : name === "@/lib/auth" ? { getCurrentStaff: async () => { calls.pos++; return state.pos ?? null; } }
          : name === "@/lib/hos-auth" ? { getCurrentHosStaff: async () => { calls.hos++; return state.hos ?? null; } }
            : name === "@/lib/host-access" ? { isKnownInternalHost: host => host === "localhost:3000" }
              : name === "@/lib/kds-device" ? {
                isHttpsSameOriginRequest: request => request.headers.get("origin") === `https://${request.headers.get("host")}`,
                isSameOriginRequest: request => {
                  try { return new URL(request.headers.get("origin")).host === request.headers.get("host"); }
                  catch { return false; }
                },
              }
              : name === "@/lib/qr-processing-policy" ? { shouldBlockQrTokenCancellation: count => count > 0 }
                : nativeRequire(name),
  });
  return { post: loaded.exports.POST, audit, updates, tables, calls };
}

function request(origin = "https://tdkon.example") {
  return new Request("https://tdkon.example/api/qr/staff-table-token", {
    method: "POST", headers: { origin, host: "tdkon.example", "Content-Type": "application/json" },
    body: JSON.stringify({ tableId: 1 }),
  });
}

test("unauthenticated and QR customer-only requests cannot cancel", async () => {
  const route = loadRoute();
  const response = await route.post(request());
  assert.equal(response.status, 401);
  assert.equal(route.updates.length, 0);
  assert.equal(route.audit.length, 0);
  assert.deepEqual(route.calls, { pos: 1, hos: 1 });
});

test("cross-origin requests are rejected before employee lookup", async () => {
  const route = loadRoute({ pos: { staffId: 7, role: "OWNER" } });
  assert.equal((await route.post(request("https://foreign.example"))).status, 403);
  assert.deepEqual(route.calls, { pos: 0, hos: 0 });
  assert.equal(route.updates.length, 0);
});

test("an internal same-origin HTTP staff request is accepted", async () => {
  const route = loadRoute({ hos: { staffId: 9, role: "STAFF" } });
  const internal = new Request("http://localhost:3000/api/qr/staff-table-token", {
    method: "POST", headers: { origin: "http://localhost:3000", host: "localhost:3000", "Content-Type": "application/json" },
    body: JSON.stringify({ tableId: 1 }),
  });
  assert.equal((await route.post(internal)).status, 200);
});

for (const [program, role] of [["pos", "OWNER"], ["pos", "STAFF"], ["hos", "STAFF"]]) {
  test(`${program} ${role} can cancel and is audited without ADM authentication`, async () => {
    const route = loadRoute({ [program]: { staffId: 7, role } });
    const response = await route.post(request());
    assert.equal(response.status, 200);
    assert.equal(route.updates.length, 2);
    assert.equal(route.updates[0].table, route.tables.qrSessions);
    assert.equal(route.updates[1].table, route.tables.qrSessionInvites);
    assert.equal(route.audit.length, 1);
    assert.equal(route.audit[0].staffId, 7);
    assert.equal(route.audit[0].entityId, 1);
    assert.match(route.audit[0].description, /closedQrSessions=1/);
    assert.equal(route.calls.hos, program === "hos" ? 1 : 0);
  });
}

test("pending QR orders prevent cancellation and success audit", async () => {
  const route = loadRoute({ pos: { staffId: 7 }, pending: true });
  const response = await route.post(request());
  assert.equal(response.status, 409);
  assert.equal(route.updates.length, 0);
  assert.equal(route.audit.length, 0);
});

test("already closed QR sessions are handled without closing them again", async () => {
  const route = loadRoute({ pos: { staffId: 7 }, qrSessions: [{ qrSessionId: 20, status: "CLOSED" }] });
  assert.equal((await route.post(request())).status, 200);
  assert.equal(route.updates.filter(item => item.table === route.tables.qrSessions).length, 0);
  assert.match(route.audit[0].description, /closedQrSessions=0/);
});
