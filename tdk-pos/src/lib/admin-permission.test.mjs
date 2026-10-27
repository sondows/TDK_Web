import assert from "node:assert/strict";
import { test } from "node:test";
import { validateStaffDraft } from "./staff-management.ts";

const draft = {
  name: "조회 직원", role: "STAFF", isActive: true,
  posEnabled: true, posPin: "1234", posPinConfirm: "1234",
  kdsEnabled: false, kdsPin: "", kdsPinConfirm: "",
  adminEnabled: true, adminPermission: "READ_ONLY", adminLoginId: "readonly.user",
  adminPin: "123456", adminPinConfirm: "123456",
};

test("POS role and management permission are independent", () => {
  assert.deepEqual(validateStaffDraft(draft), {});
  assert.deepEqual(validateStaffDraft({ ...draft, role: "OWNER", adminPermission: "READ_WRITE" }), {});
});

test("management access requires its own credentials", () => {
  assert.ok(validateStaffDraft({ ...draft, adminEnabled: false }).adminPermission);
  assert.ok(validateStaffDraft({ ...draft, adminPermission: "INVALID" }).adminPermission);
});

test("KDS access requires a separate six-digit PIN", () => {
  assert.deepEqual(validateStaffDraft({ ...draft, kdsEnabled: true, kdsPin: "123456", kdsPinConfirm: "123456" }), {});
  assert.ok(validateStaffDraft({ ...draft, kdsEnabled: true, kdsPin: "1234", kdsPinConfirm: "1234" }).kdsPin);
  assert.ok(validateStaffDraft({ ...draft, kdsEnabled: true, kdsPin: "123456", kdsPinConfirm: "654321" }).kdsPinConfirm);
});
