import assert from "node:assert/strict";
import test from "node:test";
import { classifyQrOrderAccessState } from "./qr-order-access-state.ts";

const activeSession = {
  qrStatus: "ACTIVE", sessionId: 15, tableStatus: "OPEN", sessionKind: "DINE_IN",
  expired: false, hasCompletedOrder: false, hasUnsettledOrder: false, hasPaidAllocation: false,
};

test("an expired token on an open table is an authentication timeout", () => {
  assert.equal(classifyQrOrderAccessState({ ...activeSession, expired: true }), "AUTH_EXPIRED");
});

test("a closed session is payment complete only with completed POS order and approved paid allocation", () => {
  assert.equal(classifyQrOrderAccessState({ ...activeSession, qrStatus: "CLOSED", tableStatus: "CLOSED",
    hasCompletedOrder: true, hasPaidAllocation: true }), "PAYMENT_COMPLETED");
  assert.equal(classifyQrOrderAccessState({ ...activeSession, qrStatus: "CLOSED", tableStatus: "CLOSED",
    hasCompletedOrder: true, hasUnsettledOrder: true, hasPaidAllocation: true }), "AUTH_REQUIRED");
  assert.equal(classifyQrOrderAccessState({ ...activeSession, tableStatus: "CLOSED",
    hasCompletedOrder: true, hasPaidAllocation: true }), "AUTH_REQUIRED");
  assert.equal(classifyQrOrderAccessState({ ...activeSession, qrStatus: "CLOSED", tableStatus: "CLOSED",
    hasCompletedOrder: false, hasPaidAllocation: true }), "AUTH_REQUIRED");
  assert.equal(classifyQrOrderAccessState({ ...activeSession, qrStatus: "CLOSED", tableStatus: "CLOSED",
    hasCompletedOrder: true, hasPaidAllocation: false }), "AUTH_REQUIRED");
});

test("manual token reset and unauthenticated access do not look like payment completion", () => {
  assert.equal(classifyQrOrderAccessState({ ...activeSession, qrStatus: "CLOSED" }), "AUTH_REQUIRED");
  assert.equal(classifyQrOrderAccessState({ ...activeSession, qrStatus: null, sessionId: null }), "AUTH_REQUIRED");
});
