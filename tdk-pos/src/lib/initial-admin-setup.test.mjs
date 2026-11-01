import assert from "node:assert/strict";
import test from "node:test";
import { classifyInitialMasterAccount, isFirstOwnerSetupAvailable } from "./initial-admin-setup.ts";
import ownerSetupMode from "./owner-setup-mode.cjs";

const activeOwner = {
  accountFound: true, passwordHash: null, role: "OWNER", active: 1, adminEnabled: 1,
  terminatedAt: null, staffCode: "100", isOwner: true,
};

test("first owner bootstrap requires an empty DB and an incomplete latch", () => {
  assert.equal(isFirstOwnerSetupAvailable({ latchExists: true, setupCompleted: false,
    staffExists: false, ownerExists: false }), true);
  assert.equal(isFirstOwnerSetupAvailable({ latchExists: true, setupCompleted: true,
    staffExists: false, ownerExists: false }), false);
  assert.equal(isFirstOwnerSetupAvailable({ latchExists: true, setupCompleted: false,
    staffExists: true, ownerExists: false }), false);
});

test("only an active ADM owner without a master hash can register initially", () => {
  assert.equal(classifyInitialMasterAccount(activeOwner), "MASTER_PASSWORD_REQUIRED");
  assert.equal(classifyInitialMasterAccount({ ...activeOwner, passwordHash: "hash" }), "MASTER_PASSWORD_SET");
  assert.equal(classifyInitialMasterAccount({ ...activeOwner, isOwner: false, role: "MANAGER" }),
    "REGISTRATION_NOT_ALLOWED");
  assert.equal(classifyInitialMasterAccount({ ...activeOwner, active: 0 }), "ACCOUNT_UNAVAILABLE");
  assert.equal(classifyInitialMasterAccount({ accountFound: false, passwordHash: null }), "ACCOUNT_NOT_FOUND");
});

test("only elevated Windows test mode skips the initial status rate limit", () => {
  assert.equal(ownerSetupMode.requiresInitialMasterStatusLimit({
    NODE_ENV: "development", DB_NAME: "TDK_POS_TEST", TDK_WINDOWS_DEV_OWNER_SETUP: "1",
  }), false);
  assert.equal(ownerSetupMode.requiresInitialMasterStatusLimit({
    NODE_ENV: "production", DB_NAME: "TDK_POS_TEST", TDK_WINDOWS_DEV_OWNER_SETUP: "1",
  }), true);
  assert.equal(ownerSetupMode.requiresInitialMasterStatusLimit({
    NODE_ENV: "development", DB_NAME: "TDK_POS", TDK_WINDOWS_DEV_OWNER_SETUP: "1",
  }), true);
  assert.equal(ownerSetupMode.requiresInitialMasterStatusLimit({
    NODE_ENV: "development", DB_NAME: "TDK_POS_TEST", TDK_NAS_OWNER_SETUP: "1",
  }), true);
});
