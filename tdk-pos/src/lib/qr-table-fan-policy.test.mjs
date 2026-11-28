import assert from "node:assert/strict";
import test from "node:test";
import { assignTableFan, parseTableFanAssignments } from "./qr-table-fan-policy.ts";

test("each fan can be shared, persisted and released for one table without affecting the other", () => {
  for (let fanId = 1; fanId <= 6; fanId++) {
    const first = assignTableFan({}, 1, fanId);
    const shared = assignTableFan(first, 2, fanId);
    const restored = parseTableFanAssignments(JSON.stringify(shared));
    assert.deepEqual(restored, { 1: fanId, 2: fanId });
    assert.deepEqual(assignTableFan(restored, 1, null), { 2: fanId });
    assert.deepEqual(first, { 1: fanId });
  }
});

test("older distinct assignments still load and malformed values fail closed", () => {
  assert.deepEqual(parseTableFanAssignments(null), {});
  assert.deepEqual(parseTableFanAssignments('{"1":2,"3":4}'), { 1: 2, 3: 4 });
  assert.throws(() => parseTableFanAssignments('{"0":2}'));
  assert.throws(() => parseTableFanAssignments('{"1":7}'));
  assert.throws(() => parseTableFanAssignments('{'));
});
