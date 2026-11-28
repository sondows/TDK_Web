import assert from "node:assert/strict";
import test from "node:test";
import {
  QR_ORDER_AUTH_ATTEMPT_TTL_MS,
  QR_ORDER_AUTH_MAX_FAILURES,
  QR_ORDER_AUTH_MAX_NEW_ATTEMPTS_PER_SESSION,
  QR_ORDER_AUTH_MAX_NEW_ATTEMPTS_PER_TABLE,
  canStartQrOrderAuthAttempt,
  classifyQrOrderAuthAttempt,
  nextQrOrderAuthFailure,
  qrOrderAuthCartFingerprint,
  resolveQrOrderAuthAvailability,
  validQrOrderAuthCode,
} from "./qr-order-auth-attempt-policy.ts";

test("verification code requires two digits and preserves leading zero", () => {
  assert.equal(validQrOrderAuthCode("07"), true);
  assert.equal(validQrOrderAuthCode("7"), false);
  assert.equal(validQrOrderAuthCode("7a"), false);
  assert.equal(validQrOrderAuthCode(7), false);
});

test("cart fingerprint is order-independent but changes when a selection changes", () => {
  const cart = [
    { menuId: 5, qty: 2, options: [{ modifierOptionId: 9, qty: 1 }, { modifierOptionId: 3, qty: 2 }] },
    { menuId: 2, qty: 1 },
  ];
  const reordered = [
    { menuId: 2, qty: 1 },
    { menuId: 5, qty: 2, options: [{ modifierOptionId: 3, qty: 2 }, { modifierOptionId: 9, qty: 1 }] },
  ];
  assert.equal(qrOrderAuthCartFingerprint(cart), qrOrderAuthCartFingerprint(reordered));
  assert.notEqual(qrOrderAuthCartFingerprint(cart), qrOrderAuthCartFingerprint([{ ...cart[0], qty: 3 }, cart[1]]));
});

test("server request limits have a strict boundary", () => {
  assert.equal(canStartQrOrderAuthAttempt({ session: QR_ORDER_AUTH_MAX_NEW_ATTEMPTS_PER_SESSION - 1, table: 0 }), true);
  assert.equal(canStartQrOrderAuthAttempt({ session: QR_ORDER_AUTH_MAX_NEW_ATTEMPTS_PER_SESSION, table: 0 }), false);
  assert.equal(canStartQrOrderAuthAttempt({ session: 0, table: QR_ORDER_AUTH_MAX_NEW_ATTEMPTS_PER_TABLE }), false);
  assert.equal(canStartQrOrderAuthAttempt({ session: -1, table: 0 }), false);
});

test("wrong-code attempts block at three and do not grow beyond the limit", () => {
  assert.deepEqual(nextQrOrderAuthFailure(0), { failedAttempts: 1, blocked: false });
  assert.deepEqual(nextQrOrderAuthFailure(2), { failedAttempts: QR_ORDER_AUTH_MAX_FAILURES, blocked: true });
  assert.deepEqual(nextQrOrderAuthFailure(8), { failedAttempts: QR_ORDER_AUTH_MAX_FAILURES, blocked: true });
});

test("pending attempts expire independently of the shared display TTL", () => {
  assert.equal(QR_ORDER_AUTH_ATTEMPT_TTL_MS, 120000);
  assert.equal(classifyQrOrderAuthAttempt("PENDING", 1000, 999), "PENDING");
  assert.equal(classifyQrOrderAuthAttempt("PENDING", 1000, 1000), "EXPIRED");
  assert.equal(classifyQrOrderAuthAttempt("VERIFIED", 1000, 1000), "VERIFIED");
  assert.equal(classifyQrOrderAuthAttempt("UNEXPECTED", 1000, 0), "INVALID");
});

test("production always requires TV authentication on the verified production DB", () => {
  for (const testOff of [undefined, "false", "true", "ON"]) {
    assert.equal(resolveQrOrderAuthAvailability("production", "TDK_POS", "TDK_POS", true, true, testOff), "READY");
  }
});

test("only an explicit development switch on the verified TEST DB permits legacy orders", () => {
  for (const testOff of [undefined, "false", "ON"]) {
    assert.equal(resolveQrOrderAuthAvailability("development", "TDK_POS_TEST", "TDK_POS_TEST", true, true, testOff), "READY");
  }
  assert.equal(resolveQrOrderAuthAvailability("development", "TDK_POS_TEST", "TDK_POS_TEST", true, true, "true"), "TEST_OFF");
});

test("incorrect database, runtime, schema, or TV state blocks orders even with test OFF requested", () => {
  const cases = [
    ["production", "TDK_POS_TEST", "TDK_POS_TEST", true, true],
    ["development", "TDK_POS", "TDK_POS", true, true],
    ["development", "TDK_POS_TEST", "TDK_POS", true, true],
    ["production", "TDK_POS", "TDK_POS_TEST", true, true],
    ["production", "TDK_POS", null, true, true],
    ["production", "TDK_POS", "TDK_POS", false, true],
    ["development", "TDK_POS_TEST", "TDK_POS_TEST", false, true],
    ["production", "TDK_POS", "TDK_POS", true, false],
    ["development", "TDK_POS_TEST", "TDK_POS_TEST", true, false],
    ["test", "TDK_POS_TEST", "TDK_POS_TEST", true, true],
  ];
  for (const args of cases) assert.equal(resolveQrOrderAuthAvailability(...args, "true"), "UNAVAILABLE");
});
