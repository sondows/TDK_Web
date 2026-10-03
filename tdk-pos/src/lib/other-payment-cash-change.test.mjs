import assert from "node:assert/strict";
import test from "node:test";
import { meetsCashChangeThreshold } from "./other-payment-cash-change.ts";

test("60% cash change boundary for one voucher", () => {
  assert.equal(meetsCashChangeThreshold(5_000, 10_000, 60), false);
  assert.equal(meetsCashChangeThreshold(5_999, 10_000, 60), false);
  assert.equal(meetsCashChangeThreshold(6_000, 10_000, 60), true);
  assert.equal(meetsCashChangeThreshold(8_500, 10_000, 60), true);
});

test("quantity uses total face amount and partial payments use current applied amount", () => {
  assert.equal(meetsCashChangeThreshold(17_000, 30_000, 60), false);
  assert.equal(meetsCashChangeThreshold(18_000, 30_000, 60), true);
  assert.equal(meetsCashChangeThreshold(10_000, 20_000, 60), false);
  assert.equal(meetsCashChangeThreshold(12_000, 20_000, 60), true);
});

test("zero and full-use thresholds", () => {
  assert.equal(meetsCashChangeThreshold(1, 10_000, 0), true);
  assert.equal(meetsCashChangeThreshold(9_999, 10_000, 100), false);
  assert.equal(meetsCashChangeThreshold(10_000, 10_000, 100), true);
});

test("80% voucher cash-change boundary from the reported checkout", () => {
  assert.equal(meetsCashChangeThreshold(45_000, 50_000, 80), true);
  assert.equal(meetsCashChangeThreshold(40_000, 50_000, 80), true);
  assert.equal(meetsCashChangeThreshold(39_000, 50_000, 80), false);
});
