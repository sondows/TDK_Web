import assert from "node:assert/strict";
import test from "node:test";
import { isAcceptableEmployeePin } from "./employee-pin-policy.ts";

test("employee PIN policy preserves leading zeroes and rejects short, repeated or sequential PINs", () => {
  assert.equal(isAcceptableEmployeePin("017394"), true);
  for (const pin of ["12345", "123456", "654321", "000000", "121212", "123123", "abcdef"]) {
    assert.equal(isAcceptableEmployeePin(pin), false, pin);
  }
});
