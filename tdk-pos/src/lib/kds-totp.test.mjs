import assert from "node:assert/strict";
import test from "node:test";
import { verifyTotp, newTotpSecret } from "./kds-totp.ts";

test("TOTP follows RFC 6238 SHA-1 six digit vector and time window", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(verifyTotp(secret, "287082", 59_000), true);
  assert.equal(verifyTotp(secret, "000000", 59_000), false);
  assert.equal(verifyTotp(secret, "287082", 120_000), false);
});

test("TOTP enrollment secrets are random base32 strings", () => {
  const first = newTotpSecret(), second = newTotpSecret();
  assert.match(first, /^[A-Z2-7]{32}$/);
  assert.notEqual(first, second);
});
