import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function loadRoute(dbError, logged) {
  const source = readFileSync(resolve(import.meta.dirname, "route.ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  const response = { json: async () => null };
  const nextResponse = { json: (body, init = {}) => ({ body, status: init.status ?? 200, headers: init.headers, cookies: { set() {} } }) };
  const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => { throw dbError; } }) }) }) };
  runInNewContext(js, {
    module: loaded, exports: loaded.exports, process: { env: { DB_NAME: "TDK_POS" } }, console: { error: (...args) => logged.push(args) },
    Number, String, Set, Promise, Date, Math, Boolean,
    require: name => name === "drizzle-orm" ? { eq: () => ({}), sql: () => ({}) }
      : name === "next/server" ? { NextResponse: nextResponse }
        : name === "@/db" ? { db }
          : name === "@/db/schema" ? { auditLogs: {}, managedDevices: { deviceId: "device_id" }, staff: { staffId: "staff_id", employeePinHash: "employee_pin_hash", isActive: "is_active", kdsEnabled: "kds_enabled", kdsPinChangeRequired: "kds_pin_change_required", staffCode: "staff_code", adminLoginId: "admin_login_id" }, staffSessions: {} }
            : name === "@/lib/auth" ? { createSessionToken: () => "secret", hashSessionToken: () => "hash", verifyEmployeePin: async () => true }
              : name === "@/lib/kds-login-limit" ? { clearKdsLoginAttempts: async () => {}, isKdsLoginAttemptAllowed: async () => true, recordKdsLoginFailure: async () => true }
                : name === "@/lib/kds-auth" ? { KDS_SESSION_COOKIE_NAME: "kds", kdsSessionCookieOptions: {} }
                  : name === "@/lib/kds-device" ? { getCurrentKdsDevice: async () => null, kdsCookieSecureForRequest: () => true, reserveKdsIpAttempt: async () => true, isSameOriginRequest: () => true }
                    : name === "@/lib/kds-network-server" ? { getKdsNetworkContext: async () => ({ isInternal: true }) }
                      : name === "@/lib/kds-auth-errors" ? { getKdsForeignKeyViolation: () => null, getKdsAuthSchemaError: error => {
                        const code = error.code ?? error.cause?.code;
                        return ["ER_BAD_FIELD_ERROR", "ER_NO_SUCH_TABLE", "ER_BAD_TABLE_ERROR"].includes(code) ? { code, name: error.name } : null;
                      } }
                        : (() => { throw new Error(`Unexpected import: ${name}`); })(),
  });
  return { post: loaded.exports.POST, response };
}

test("missing KDS auth schema returns a distinct 503 without logging SQL or credentials", async () => {
  const logged = [];
  const { post } = loadRoute(Object.assign(new Error("Unknown column employee_pin_hash"), { code: "ER_BAD_FIELD_ERROR" }), logged);
  const result = await post({ json: async () => ({ loginId: "sondows", pin: "123456" }) });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "KDS_AUTH_SCHEMA_MISMATCH");
  assert.equal(logged[0][1].stage, "employee_lookup");
  assert.equal(logged[0][1].dbName, "TDK_POS");
  assert.equal(JSON.stringify(logged).includes("123456"), false);
  assert.equal(JSON.stringify(logged).includes("Unknown column"), false);
});

test("non-schema database failures remain a generic service unavailable response", async () => {
  const logged = [];
  const { post } = loadRoute(Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }), logged);
  const result = await post({ json: async () => ({ loginId: "sondows", pin: "123456" }) });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "KDS_AUTH_UNAVAILABLE");
  assert.equal(logged[0][1].category, "service_unavailable");
});
