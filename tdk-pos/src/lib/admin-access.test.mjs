import assert from "node:assert/strict";
import { test } from "node:test";
import { validateStaffDraft } from "./staff-management.ts";

const draft = {
  name: "직원", loginId: "staff01", role: "STAFF", isActive: true,
  posEnabled: true, kdsEnabled: false, hosEnabled: false,
  employeePin: "012345", employeePinConfirm: "012345",
  adminEnabled: true,
};

test("POS role, employee PIN, and ADM enablement stay independent", () => {
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

test("new program-enabled employees require one matching six-digit employee PIN", () => {
  assert.deepEqual(validateStaffDraft(draft), {});
  assert.ok(validateStaffDraft({ ...draft, employeePin: "12345", employeePinConfirm: "12345" }).employeePin);
  assert.ok(validateStaffDraft({ ...draft, employeePinConfirm: "654321" }).employeePinConfirm);
  assert.ok(validateStaffDraft({ ...draft, employeePin: "", employeePinConfirm: "", kdsEnabled: true }).employeePin);
  assert.ok(validateStaffDraft({ ...draft, employeePin: "", employeePinConfirm: "", posEnabled: false, hosEnabled: true }).employeePin);
});

test("employees with program access require a common PIN before they can use the unified login", () => {
  const existing = { posEnabled: true, kdsEnabled: true, hosEnabled: false, adminEnabled: true, hasLegacyAdminPin: true, hasEmployeePin: false, hasLegacyPosPin: true, hasKdsPin: true };
  assert.ok(validateStaffDraft({ ...draft, employeePin: "", employeePinConfirm: "" }, existing).employeePin);
});
