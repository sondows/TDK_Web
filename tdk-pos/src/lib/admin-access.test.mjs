import assert from "node:assert/strict";
import { test } from "node:test";
import { validateStaffDraft } from "./staff-management.ts";

const draft = {
  name: "직원", loginId: "staff01", role: "STAFF", isActive: true,
  posEnabled: true, kdsEnabled: false, hosEnabled: false,
  employeePin: "", employeePinConfirm: "",
  adminEnabled: true,
};

test("POS role and ADM enablement stay independent of PIN enrollment", () => {
  assert.deepEqual(validateStaffDraft(draft), {});
  assert.deepEqual(validateStaffDraft({ ...draft, role: "OWNER" }), {});
});

test("ADM access is controlled by its enablement flag without a read/write sub-permission", () => {
  assert.deepEqual(validateStaffDraft({ ...draft, adminEnabled: false }), {});
});

test("employee login IDs must be unique-format lowercase identifiers", () => {
  assert.ok(validateStaffDraft({ ...draft, loginId: "Bad ID" }).loginId);
  assert.ok(validateStaffDraft({ ...draft, loginId: "ok_user9" }).loginId === undefined);
});

test("administrators cannot set another employee's PIN through staff management", () => {
  assert.deepEqual(validateStaffDraft(draft), {});
  assert.ok(validateStaffDraft({ ...draft, employeePin: "123456", employeePinConfirm: "123456" }).employeePin);
  assert.deepEqual(validateStaffDraft({ ...draft, kdsEnabled: true }), {});
  assert.deepEqual(validateStaffDraft({ ...draft, posEnabled: false, hosEnabled: true }), {});
});

test("an existing employee without a PIN remains editable while PIN setup is pending", () => {
  const existing = { posEnabled: true, kdsEnabled: true, hosEnabled: false, adminEnabled: true, hasEmployeePin: false };
  assert.deepEqual(validateStaffDraft(draft, existing), {});
});
