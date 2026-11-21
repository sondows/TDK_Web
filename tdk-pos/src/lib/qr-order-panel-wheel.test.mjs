import test from "node:test";
import assert from "node:assert/strict";
import { accumulateQrPanelWheelIntent } from "./qr-order-panel-wheel.ts";

test("small wheel deltas accumulate until one snap threshold is reached", () => {
  let intent = null;
  let result = accumulateQrPanelWheelIntent(intent, -12);
  assert.equal(result.shouldAdvance, false);
  intent = result.intent;

  result = accumulateQrPanelWheelIntent(intent, -20);
  assert.equal(result.shouldAdvance, false);
  intent = result.intent;

  result = accumulateQrPanelWheelIntent(intent, -16);
  assert.equal(result.shouldAdvance, true);
  assert.equal(result.intent.accumulated, 48);
});

test("changing wheel direction starts a fresh accumulator", () => {
  const first = accumulateQrPanelWheelIntent(null, -36);
  assert.equal(first.shouldAdvance, false);

  const reversed = accumulateQrPanelWheelIntent(first.intent, 24);
  assert.equal(reversed.shouldAdvance, false);
  assert.equal(reversed.intent.direction, 1);
  assert.equal(reversed.intent.accumulated, 24);
});

test("one continuous wheel burst cannot advance multiple snap stages", () => {
  const advanced = accumulateQrPanelWheelIntent(null, 60);
  assert.equal(advanced.shouldAdvance, true);

  const continued = accumulateQrPanelWheelIntent(advanced.intent, 120);
  assert.equal(continued.shouldAdvance, false);
  assert.equal(continued.intent.accumulated, 48);
});

test("zero and non-finite deltas are ignored", () => {
  assert.equal(accumulateQrPanelWheelIntent(null, 0), null);
  assert.equal(accumulateQrPanelWheelIntent(null, Number.NaN), null);
});
