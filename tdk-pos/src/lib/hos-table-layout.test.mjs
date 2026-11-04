import assert from "node:assert/strict";
import test from "node:test";
import { clampHosTableLayout, defaultHosTableLayout, hasHosLayoutOverlap, isValidHosTableLayout, resolveHosTableLayouts, snapHosPositionToGrid } from "./hos-table-layout.ts";

test("default HOS tables start in one editable column", () => {
  const tables = Array.from({ length: 12 }, (_, index) => ({ tableId: index + 1, tableNo: String(index + 1) }));
  const layouts = resolveHosTableLayouts(tables, new Map());
  assert.ok(layouts.every(table => table.positionX === 50 && table.layoutWidth === 85));
  assert.ok(layouts.every((table, index) => index === 0 || table.positionY > layouts[index - 1].positionY));
});

test("table numbers are sorted numerically before default placement", () => {
  const layouts = resolveHosTableLayouts([
    { tableId: 10, tableNo: "10" }, { tableId: 2, tableNo: "2" }, { tableId: 1, tableNo: "1" },
  ], new Map());
  assert.deepEqual(layouts.map(table => table.tableNo), ["1", "2", "10"]);
});

test("an unconfigured table receives a basic fallback without moving saved layouts", () => {
  const tables = Array.from({ length: 4 }, (_, index) => ({ tableId: index + 1, tableNo: String(index + 1) }));
  const stored = new Map([[1, { ...defaultHosTableLayout(0, 4), positionX: 50, positionY: 25 }]]);
  const layouts = resolveHosTableLayouts(tables, stored);
  assert.deepEqual([layouts[0].positionX, layouts[0].positionY], [50, 25]);
  assert.equal(layouts[1].positionX, 50);
});

test("default positions may remain off-grid and overlapping layouts are valid", () => {
  const first = { positionX: 50.2, positionY: 40.7, layoutWidth: 30, layoutHeight: 20, isVisible: true };
  const second = { ...first, positionX: 50.5, positionY: 40.9 };
  assert.ok(isValidHosTableLayout(first));
  assert.ok(isValidHosTableLayout(second));
  assert.equal(hasHosLayoutOverlap([{ tableId: 1, tableNo: "1", ...first }, { tableId: 2, tableNo: "2", ...second }]), true);
});

test("default layouts remain valid across varied table counts", () => {
  for (const count of [1, 2, 3, 4, 8, 9, 10, 12, 18, 24, 36, 60, 90]) {
    const tables = Array.from({ length: count }, (_, index) => ({ tableId: index + 1, tableNo: String(index + 1) }));
    const layouts = resolveHosTableLayouts(tables, new Map());
    assert.ok(layouts.every(isValidHosTableLayout), `layout count ${count}`);
  }
});

test("HOS dimensions can grow close to the canvas size without moving unrelated tables", () => {
  const wide = { positionX: 50, positionY: 50, layoutWidth: 95, layoutHeight: 95, isVisible: true };
  const other = { tableId: 2, tableNo: "2", positionX: 15, positionY: 80, layoutWidth: 20, layoutHeight: 10, isVisible: true };
  assert.ok(isValidHosTableLayout(wide));
  assert.ok(isValidHosTableLayout(other));
  const resolved = resolveHosTableLayouts([other, { tableId: 1, tableNo: "1" }], new Map([[1, wide], [2, other]]));
  const resolvedWide = resolved.find(table => table.tableId === 1);
  const resolvedOther = resolved.find(table => table.tableId === 2);
  assert.deepEqual([resolvedOther.positionX, resolvedOther.positionY, resolvedOther.layoutWidth, resolvedOther.layoutHeight], [15, 80, 20, 10]);
  assert.deepEqual([resolvedWide.positionX, resolvedWide.positionY, resolvedWide.layoutWidth, resolvedWide.layoutHeight], [50, 50, 95, 95]);
});

test("saved two-column, irregular, and overlapping layouts are returned without grid reflow", () => {
  const tables = Array.from({ length: 6 }, (_, index) => ({ tableId: index + 1, tableNo: String(index + 1) }));
  const positions = [
    [24.2, 18.6], [24.2, 49.1], [24.2, 81.4],
    [75.8, 23.3], [75.8, 56.7], [51.1, 54.4],
  ];
  const stored = new Map(tables.map((table, index) => [table.tableId, {
    positionX: positions[index][0], positionY: positions[index][1],
    layoutWidth: index === 5 ? 35 : 27.5, layoutHeight: index === 5 ? 20 : 17.5, isVisible: true,
  }]));

  const resolved = resolveHosTableLayouts(tables, stored);

  assert.deepEqual(resolved.map(table => [table.positionX, table.positionY]), positions);
  assert.equal(resolved[5].layoutWidth, 35);
  assert.equal(resolved[5].layoutHeight, 20);
  assert.equal(hasHosLayoutOverlap(resolved), true);
});

test("saved one-, two-, and three-column arrangements keep their requested coordinates", () => {
  const arrangements = [
    [[50, 20], [50, 50], [50, 80]],
    [[25, 20], [75, 50], [25, 80]],
    [[18, 20], [50, 50], [82, 80]],
  ];
  for (const positions of arrangements) {
    const tables = positions.map((_, index) => ({ tableId: index + 1, tableNo: String(index + 1) }));
    const stored = new Map(tables.map((table, index) => [table.tableId, {
      positionX: positions[index][0], positionY: positions[index][1],
      layoutWidth: 20, layoutHeight: 10, isVisible: true,
    }]));
    const resolved = resolveHosTableLayouts(tables, stored);
    assert.deepEqual(resolved.map(table => [table.positionX, table.positionY]), positions);
  }
});

test("dragging to a canvas edge keeps the center coordinate valid", () => {
  const edge = clampHosTableLayout({ positionX: 0, positionY: 100, layoutWidth: 27.5, layoutHeight: 17.5, isVisible: true });
  assert.ok(isValidHosTableLayout(edge));
  assert.deepEqual([edge.positionX, edge.positionY], [0, 100]);
});

test("drag and resize keep fractional coordinates while staying inside canvas bounds", () => {
  const layout = clampHosTableLayout({ positionX: 35.3, positionY: 62.8, layoutWidth: 31.7, layoutHeight: 21.3, isVisible: true });
  assert.deepEqual(layout, { positionX: 35.3, positionY: 62.8, layoutWidth: 31.7, layoutHeight: 21.3, isVisible: true });
  const edge = clampHosTableLayout({ ...layout, positionX: 100, positionY: 0 });
  assert.equal(edge.positionX, 100);
  assert.equal(edge.positionY, 0);
  assert.ok(isValidHosTableLayout(edge));
});

test("resizing a table preserves its position even when the table extends beyond the canvas", () => {
  const before = { positionX: 12, positionY: 84, layoutWidth: 20, layoutHeight: 12, isVisible: true };
  const after = clampHosTableLayout({ ...before, layoutWidth: 90, layoutHeight: 40 });
  assert.deepEqual([after.positionX, after.positionY], [before.positionX, before.positionY]);
  assert.deepEqual([after.layoutWidth, after.layoutHeight], [90, 40]);
  assert.ok(isValidHosTableLayout(after));
});

test("grid snapping aligns both axes to the configured canvas pixel spacing", () => {
  assert.deepEqual(snapHosPositionToGrid(26, 43, 200, 300, 10), { positionX: 25, positionY: 43.333333333333336 });
  assert.deepEqual(snapHosPositionToGrid(99.9, 99.9, 203, 297, 25), { positionX: 98.52216748768473, positionY: 92.5925925925926 });
});
