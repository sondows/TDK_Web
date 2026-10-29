import assert from "node:assert/strict";
import test from "node:test";
import { canAddSecurityOwner, canRemoveSecurityOwner, canResetSecurityOwner, isSecurityOwnerSetupPending } from "./admin-security-owners.ts";

test("only active ADM users with a common PIN can be promoted", () => {
  const valid = { isActive: 1, adminEnabled: 1, loginId: "worker01", employeePinHash: "hash" };
  assert.equal(canAddSecurityOwner(valid), true);
  assert.equal(canAddSecurityOwner({ ...valid, isActive: 0 }), false);
  assert.equal(canAddSecurityOwner({ ...valid, adminEnabled: 0 }), false);
  assert.equal(canAddSecurityOwner({ ...valid, employeePinHash: null }), false);
});

test("cannot revoke or reset the final configured security owner", () => {
  assert.equal(canRemoveSecurityOwner([{ staffId: 1, passwordHash: "hash" }], 1), false);
  assert.equal(canRemoveSecurityOwner([
    { staffId: 1, passwordHash: "hash" }, { staffId: 2, passwordHash: null },
  ], 1), false);
  assert.equal(canRemoveSecurityOwner([
    { staffId: 1, passwordHash: "hash" }, { staffId: 2, passwordHash: "other" },
  ], 1), true);
  assert.equal(canRemoveSecurityOwner([
    { staffId: 1, passwordHash: null }, { staffId: 2, passwordHash: "other" },
  ], 1), true);
});

test("a missing per-owner hash is represented as setup pending", () => {
  assert.equal(isSecurityOwnerSetupPending(null), true);
  assert.equal(isSecurityOwnerSetupPending(undefined), true);
  assert.equal(isSecurityOwnerSetupPending("scrypt$..."), false);
});

test("password reset requires a different active owner and preserves one configured owner", () => {
  const owners = [
    { staffId: 1, passwordHash: "hash-1", credentialState: "ACTIVE" },
    { staffId: 2, passwordHash: "hash-2", credentialState: "ACTIVE" },
  ];
  assert.equal(canResetSecurityOwner(owners, 1, 2), true);
  assert.equal(canResetSecurityOwner(owners, 1, 1), false);
  assert.equal(canResetSecurityOwner([{ ...owners[0], staffId: 2 }], 1, 2), false);
  assert.equal(canResetSecurityOwner([{ ...owners[1], credentialState: "RESET_REQUIRED" }], 1, 2), false);
});
