import assert from "node:assert/strict";
import test from "node:test";
import { getQrHeroTouchIntent } from "./qr-hero-touch-intent.ts";

test("hero taps are distinguished from horizontal and vertical swipes", () => {
  assert.equal(getQrHeroTouchIntent(4, 5), "tap");
  assert.equal(getQrHeroTouchIntent(-60, 8), "left");
  assert.equal(getQrHeroTouchIntent(58, -3), "right");
  assert.equal(getQrHeroTouchIntent(4, -50), "up");
  assert.equal(getQrHeroTouchIntent(3, 52), "down");
  assert.equal(getQrHeroTouchIntent(16, 18), null);
});
