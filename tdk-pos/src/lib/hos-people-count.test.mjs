import test from "node:test";
import assert from "node:assert/strict";
import { resolveHosPeopleCount } from "./hos-people-count.ts";

test("stored nonzero POS people counts take precedence over stew-order defaults", () => {
  assert.deepEqual(resolveHosPeopleCount({ personCount: 2, babyCount: 1, stewOrderCount: 4 }), { personCount: 2, babyCount: 1 });
});

test("unset 0/0 counts use the existing kimchi-stew order default", () => {
  assert.deepEqual(resolveHosPeopleCount({ personCount: 0, babyCount: 0, stewOrderCount: 3 }), { personCount: 3, babyCount: 0 });
});

test("a just-saved explicit zero count remains visible for the current session", () => {
  assert.deepEqual(resolveHosPeopleCount({ personCount: 0, babyCount: 0, stewOrderCount: 3, savedOverride: { personCount: 0, babyCount: 0 } }), { personCount: 0, babyCount: 0 });
});

test("stale local counts do not override newer POS values", () => {
  assert.deepEqual(resolveHosPeopleCount({ personCount: 4, babyCount: 1, stewOrderCount: 3, savedOverride: { personCount: 2, babyCount: 0 } }), { personCount: 4, babyCount: 1 });
});
