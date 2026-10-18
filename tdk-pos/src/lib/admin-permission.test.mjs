import assert from "node:assert/strict";
import { test } from "node:test";
import { validateStaffDraft } from "./staff-management.ts";

const draft = {
  name: "조회 직원", role: "STAFF", isActive: true,
  posEnabled: true, posPin: "1234", posPinConfirm: "1234",
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
