import assert from "node:assert/strict";
import test from "node:test";
import { formatTvQrAuthCode, getVisibleTvQrAuthCode, isStaleTvQrAuthCodeResponse, isTvAuthCodeTestIssueAllowed,
  shouldDisplayTvQrAuthCode } from "./tdktv-qr-auth-code-policy.ts";

test("TV QR auth codes are two digit strings including leading zeroes", () => {
  assert.equal(formatTvQrAuthCode(0), "00");
  assert.equal(formatTvQrAuthCode(7), "07");
  assert.equal(formatTvQrAuthCode(99), "99");
  assert.throws(() => formatTvQrAuthCode(100), RangeError);
  assert.throws(() => formatTvQrAuthCode(-1), RangeError);
});

test("test issuance is limited to the development server connected to TDK_POS_TEST", () => {
  assert.equal(isTvAuthCodeTestIssueAllowed("development", "TDK_POS_TEST"), true);
  assert.equal(isTvAuthCodeTestIssueAllowed("production", "TDK_POS_TEST"), false);
  assert.equal(isTvAuthCodeTestIssueAllowed("development", "TDK_POS"), false);
  assert.equal(isTvAuthCodeTestIssueAllowed("development", undefined), false);
});

test("only DP1 shows the code and TV-4 notice always takes priority", () => {
  assert.equal(shouldDisplayTvQrAuthCode("DP1", false), true);
  assert.equal(shouldDisplayTvQrAuthCode("dp1", false), true);
  assert.equal(shouldDisplayTvQrAuthCode("DP2", false), false);
  assert.equal(shouldDisplayTvQrAuthCode("DP1", true), false);
});

test("TV QR overlay exists only for a current two-digit DP1 code", () => {
  assert.equal(getVisibleTvQrAuthCode("DP1", false, null), null);
  assert.equal(getVisibleTvQrAuthCode("DP1", false, "00"), "00");
  assert.equal(getVisibleTvQrAuthCode("DP1", false, "99"), "99");
  assert.equal(getVisibleTvQrAuthCode("DP1", false, "--"), null);
  assert.equal(getVisibleTvQrAuthCode("DP1", false, "1"), null);
  assert.equal(getVisibleTvQrAuthCode("DP1", true, "42"), null);
  assert.equal(getVisibleTvQrAuthCode("DP2", false, "42"), null);
  assert.equal(getVisibleTvQrAuthCode("DP1", false, null), null);
});

test("out-of-order polling responses cannot roll the shared code state backward", () => {
  const latest = { stateVersion: "12", serverNowMs: 20000 };
  assert.equal(isStaleTvQrAuthCodeResponse({ stateVersion: "11", serverNowMs: 21000 }, latest), true);
  assert.equal(isStaleTvQrAuthCodeResponse({ stateVersion: "12", serverNowMs: 19000 }, latest), true);
  assert.equal(isStaleTvQrAuthCodeResponse({ stateVersion: "13", serverNowMs: 21000 }, latest), false);
  assert.equal(isStaleTvQrAuthCodeResponse({ stateVersion: "10000000000000000", serverNowMs: 21000 }, latest), false);
  assert.equal(isStaleTvQrAuthCodeResponse({ stateVersion: "invalid", serverNowMs: 21000 }, latest), true);
});
