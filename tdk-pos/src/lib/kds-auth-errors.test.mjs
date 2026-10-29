import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(resolve(import.meta.dirname, "kds-auth-errors.ts"), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
runInNewContext(js, { module: loaded, exports: loaded.exports, Set, Number, String });
const { getKdsAuthSchemaError, getKdsForeignKeyViolation } = loaded.exports;

test("classifies MySQL missing columns and missing tables without exposing details", () => {
  assert.deepEqual({ ...getKdsAuthSchemaError({ code: "ER_BAD_FIELD_ERROR", message: "employee_pin_hash" }) }, {
    code: "ER_BAD_FIELD_ERROR", name: "DatabaseSchemaError",
  });
  assert.equal(getKdsAuthSchemaError({ errno: 1146 })?.code, "1146");
});

test("classifies wrapped MySQL errors and ignores ordinary failures", () => {
  assert.equal(getKdsAuthSchemaError({ cause: { code: "ER_NO_SUCH_TABLE", name: "QueryError" } })?.code, "ER_NO_SUCH_TABLE");
  assert.equal(getKdsAuthSchemaError({ code: "ECONNREFUSED" }), null);
  assert.equal(getKdsAuthSchemaError(new Error("generic")), null);
});

test("extracts only foreign-key identifiers and columns from the MySQL diagnostic", () => {
  const result = getKdsForeignKeyViolation({
    code: "ER_NO_REFERENCED_ROW_2",
    sqlMessage: "Cannot add child row (TDK_POS_TEST.staff_sessions, CONSTRAINT `fk_session_device` FOREIGN KEY (`device_id`) REFERENCES `kds_trusted_devices` (`device_id`))",
  });
  assert.deepEqual({ ...result }, {
    constraint: "fk_session_device", childTable: "staff_sessions", childColumn: "device_id",
    parentTable: "kds_trusted_devices", parentColumn: "device_id",
  });
  assert.equal(getKdsForeignKeyViolation({ code: "ER_NO_REFERENCED_ROW_2", sqlMessage: "other" }), null);
  assert.equal(getKdsForeignKeyViolation({ code: "ER_BAD_FIELD_ERROR", sqlMessage: "employee_pin_hash" }), null);
});
