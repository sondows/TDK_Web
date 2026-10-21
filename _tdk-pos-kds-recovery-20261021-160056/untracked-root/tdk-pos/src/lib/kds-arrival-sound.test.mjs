import assert from "node:assert/strict";
import test from "node:test";
import { collectNewKdsOrderIds, DEFAULT_KDS_ARRIVAL_SOUND_SETTINGS, parseKdsArrivalSoundSettings } from "./kds-arrival-sound.ts";

test("KDS arrival sound uses enabled/default/one-repeat defaults for an unset store", () => {
  assert.deepEqual(parseKdsArrivalSoundSettings(new Map()), DEFAULT_KDS_ARRIVAL_SOUND_SETTINGS);
});

test("KDS arrival sound parses store settings and falls back from invalid values", () => {
  assert.deepEqual(parseKdsArrivalSoundSettings(new Map([
    ["kds_arrival_sound_enabled", "0"],
    ["kds_arrival_sound_key", "chime"],
    ["kds_arrival_sound_repeat", "3"],
  ])), { enabled: false, soundKey: "chime", repeat: 3 });
  assert.deepEqual(parseKdsArrivalSoundSettings(new Map([
    ["kds_arrival_sound_key", "external-url"],
    ["kds_arrival_sound_repeat", "99"],
  ])), DEFAULT_KDS_ARRIVAL_SOUND_SETTINGS);
});

test("new waiting tasks notify once per new order, not once per task", () => {
  const known = new Set([10]);
  const arrivals = collectNewKdsOrderIds([
    { orderId: 10, status: "WAITING" },
    { orderId: 11, status: "WAITING" },
    { orderId: 11, status: "WAITING" },
    { orderId: 12, status: "DONE" },
  ], known);
  assert.deepEqual([...arrivals], [11]);
});
