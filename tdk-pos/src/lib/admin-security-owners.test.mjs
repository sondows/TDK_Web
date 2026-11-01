import assert from "node:assert/strict";
import test from "node:test";
import { canAddSecurityOwner, canRemoveSecurityOwner, isSecurityOwnerSetupPending } from "./admin-security-owners.ts";

test("only active ADM users with a common PIN can be promoted", () => {
  const valid = { isActive: 1, adminEnabled: 1, loginId: "worker01", employeePinHash: "hash" };
  assert.equal(canAddSecurityOwner(valid), true);
  assert.equal(canAddSecurityOwner({ ...valid, isActive: 0 }), false);
  assert.equal(canAddSecurityOwner({ ...valid, adminEnabled: 0 }), false);
  assert.equal(canAddSecurityOwner({ ...valid, employeePinHash: null }), false);
});

test("cannot revoke the final active owner with a master password", () => {
  const owner = { staffId: 1, masterPasswordHash: "hash", isActive: 1, adminEnabled: 1, terminatedAt: null };
  assert.equal(canRemoveSecurityOwner([owner], 1), false);
  assert.equal(canRemoveSecurityOwner([
    owner, { staffId: 2, masterPasswordHash: null, isActive: 1, adminEnabled: 1, terminatedAt: null },
  ], 1), false);
  assert.equal(canRemoveSecurityOwner([
    owner, { ...owner, staffId: 2, masterPasswordHash: "other" },
  ], 1), true);
  assert.equal(canRemoveSecurityOwner([
    { ...owner, masterPasswordHash: null }, { ...owner, staffId: 2, masterPasswordHash: "other" },
  ], 1), true);
  assert.equal(canRemoveSecurityOwner([owner, { ...owner, staffId: 2, isActive: 0 }], 1), false);
  assert.equal(canRemoveSecurityOwner([owner, { ...owner, staffId: 2, terminatedAt: new Date() }], 1), false);
});

test("a missing per-owner hash is represented as setup pending", () => {
  assert.equal(isSecurityOwnerSetupPending(null), true);
  assert.equal(isSecurityOwnerSetupPending(undefined), true);
  assert.equal(isSecurityOwnerSetupPending("scrypt$..."), false);
});
