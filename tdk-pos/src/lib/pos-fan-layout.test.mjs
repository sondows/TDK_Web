import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_POS_FAN_LAYOUTS, getPosFanSettingKey, isValidPosFanLayouts, parsePosFanLayout } from "./pos-fan-layout.ts";

test("six fan defaults map to the supplied Home Assistant switch IDs and stay hidden until placed", () => {
  assert.equal(DEFAULT_POS_FAN_LAYOUTS.length, 6);
  assert.deepEqual(DEFAULT_POS_FAN_LAYOUTS.map(fan => fan.entityId), [
    "switch.sonoff_a4b0026ef4", "switch.sonoff_a4b0026ef9", "switch.sonoff_a4b0026ef3",
    "switch.sonoff_a4b0026ef8", "switch.sonoff_a4b0026ef5", "switch.sonoff_a4b0026ef7",
  ]);
  assert.ok(DEFAULT_POS_FAN_LAYOUTS.every(fan => !fan.isVisible));
  assert.equal(getPosFanSettingKey(6), "pos.fan-layout.6");
});

test("fan configuration accepts the six unique mapped switches and valid scene positions", () => {
  assert.equal(isValidPosFanLayouts(DEFAULT_POS_FAN_LAYOUTS), true);
  assert.equal(isValidPosFanLayouts(DEFAULT_POS_FAN_LAYOUTS.map(fan => ({ ...fan, positionX: 100, positionY: 0 }))), true);
});

test("fan configuration rejects duplicates, unknown HA switches, and out-of-range positions", () => {
  assert.equal(isValidPosFanLayouts(DEFAULT_POS_FAN_LAYOUTS.map((fan, index) => index ? fan : { ...fan, entityId: DEFAULT_POS_FAN_LAYOUTS[1].entityId })), false);
  assert.equal(isValidPosFanLayouts(DEFAULT_POS_FAN_LAYOUTS.map((fan, index) => index ? fan : { ...fan, entityId: "switch.unapproved" })), false);
  assert.equal(isValidPosFanLayouts(DEFAULT_POS_FAN_LAYOUTS.map((fan, index) => index ? fan : { ...fan, positionX: 100.1 })), false);
});

test("stored fan setting parser rejects malformed values", () => {
  assert.equal(parsePosFanLayout(null), null);
  assert.equal(parsePosFanLayout("not json"), null);
  assert.deepEqual(parsePosFanLayout(JSON.stringify(DEFAULT_POS_FAN_LAYOUTS[0])), DEFAULT_POS_FAN_LAYOUTS[0]);
});
