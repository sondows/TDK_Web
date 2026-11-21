import assert from "node:assert/strict";
import test from "node:test";
import { qrOrderApprovalTarget } from "./qr-order-approval-navigation.ts";

test("successful QR approval navigates by the selected table ID", () => {
  assert.equal(qrOrderApprovalTarget("ACCEPT", true, 2), 2);
});

test("failed decisions and rejection never request table navigation", () => {
  assert.equal(qrOrderApprovalTarget("ACCEPT", false, 2), null);
  assert.equal(qrOrderApprovalTarget("REJECT", true, 2), null);
  assert.equal(qrOrderApprovalTarget("ACCEPT", true, null), null);
  assert.equal(qrOrderApprovalTarget("ACCEPT", true, 0), null);
});
