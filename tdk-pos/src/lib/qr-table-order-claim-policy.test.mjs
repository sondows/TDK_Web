import assert from "node:assert/strict";
import test from "node:test";
import { classifyQrRepresentativePermission, sameQrClaimIdentity } from "./qr-table-order-claim-policy.ts";

const pending = { tableId: 1, representativeQrSessionId: 2, firstQrOrderId: 3, state: "PENDING" };
test("identity requires table, customer and first request", () => {
  assert.equal(sameQrClaimIdentity(pending, pending), true);
  assert.equal(sameQrClaimIdentity(pending, { ...pending, tableId: 4 }), false);
  assert.equal(sameQrClaimIdentity(pending, { ...pending, representativeQrSessionId: 4 }), false);
  assert.equal(sameQrClaimIdentity(pending, { ...pending, firstQrOrderId: 4 }), false);
});
test("representative permission covers both states and both customers", () => {
  assert.equal(classifyQrRepresentativePermission(null, 2), "NO_REPRESENTATIVE");
  assert.equal(classifyQrRepresentativePermission(pending, 2), "OWN_PENDING");
  assert.equal(classifyQrRepresentativePermission(pending, 9), "OTHER_PENDING");
  assert.equal(classifyQrRepresentativePermission({ ...pending, state: "CONFIRMED" }, 2), "OWN_CONFIRMED");
  assert.equal(classifyQrRepresentativePermission({ ...pending, state: "CONFIRMED" }, 9), "OTHER_CONFIRMED");
});
