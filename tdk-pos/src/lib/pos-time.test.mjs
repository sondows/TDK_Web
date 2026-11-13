import assert from "node:assert/strict";
import test from "node:test";
import { getPosDayRange } from "./pos-time.ts";

test("POS day bounds follow the Seoul date immediately around UTC midnight", () => {
  assert.deepEqual(getPosDayRange(new Date("2026-11-12T14:59:59.999Z")), {
    date: "2026-11-12", start: "2026-11-12 00:00:00", end: "2026-11-13 00:00:00",
  });
  assert.deepEqual(getPosDayRange(new Date("2026-11-12T15:00:00.000Z")), {
    date: "2026-11-13", start: "2026-11-13 00:00:00", end: "2026-11-14 00:00:00",
  });
});

test("POS day bounds roll over month and year ends", () => {
  assert.deepEqual(getPosDayRange(new Date("2026-12-31T15:00:00.000Z")), {
    date: "2027-01-01", start: "2027-01-01 00:00:00", end: "2027-01-02 00:00:00",
  });
});
