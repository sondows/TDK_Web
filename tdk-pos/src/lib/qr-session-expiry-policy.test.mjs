import assert from "node:assert/strict";
import test from "node:test";
import { qrSessionCookieMaxAgeSeconds } from "./qr-session-expiry-policy.ts";

const SIX_HOURS_SECONDS = 6 * 60 * 60;
const hour = 60 * 60 * 1000;

test("an invitee who joins five hours after the first QR token gets one hour", () => {
  const issuedAt = Date.UTC(2026, 10, 19, 0, 0, 0);
  const expiresAt = issuedAt + 6 * hour;
  const joinedAt = issuedAt + 5 * hour;
  assert.equal(qrSessionCookieMaxAgeSeconds((expiresAt - joinedAt) / 1000, SIX_HOURS_SECONDS), 60 * 60);
});

test("a newly issued customer cookie cannot exceed the remaining shared session lifetime", () => {
  const issuedAt = Date.UTC(2026, 10, 19, 0, 0, 0);
  const expiresAt = issuedAt + 6 * hour;
  assert.equal(qrSessionCookieMaxAgeSeconds((expiresAt - issuedAt) / 1000, SIX_HOURS_SECONDS), SIX_HOURS_SECONDS);
});

test("an expired shared session gets no cookie lifetime", () => {
  const issuedAt = Date.UTC(2026, 10, 19, 0, 0, 0);
  const expiresAt = issuedAt + 6 * hour;
  assert.equal(qrSessionCookieMaxAgeSeconds((expiresAt - (issuedAt + 7 * hour)) / 1000, SIX_HOURS_SECONDS), 0);
  assert.equal(qrSessionCookieMaxAgeSeconds((expiresAt - (issuedAt + 30 * 60 * 1000)) / 1000, SIX_HOURS_SECONDS), 5.5 * 60 * 60);
});
