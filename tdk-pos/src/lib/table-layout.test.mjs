import assert from "node:assert/strict";
import test from "node:test";
import { TABLE_LAYOUT_REFERENCE_CANVAS, clampTableLayoutToCanvas, posMainFixedTableBodySize, posMainFixedTablePosition, posMainFixedTableSize, tableSceneScaleToFit } from "./table-layout.ts";

const reference = TABLE_LAYOUT_REFERENCE_CANVAS;

test("all table screens share the 1300 by 900 logical canvas", () => {
  assert.deepEqual(reference, { width: 1300, height: 900 });
});

test("1920 by 1080 POS fits the new scene uniformly within its available canvas", () => {
  const middleWidth = (1920 - 24 - 24) * 0.4705;
  const canvasWidth = middleWidth - 32; // Same 16px side gutters as the request/message panel.
  const middleHeight = 1080 - 24 - 104 - 12;
  const scale = tableSceneScaleToFit(canvasWidth, middleHeight * 0.72, reference.width, reference.height);
  const table = { positionX: 36, positionY: 50, layoutWidth: 200, layoutHeight: 140, rotation: 0 };

  assert.equal(scale, canvasWidth / reference.width);
  assert.ok(reference.width * scale <= canvasWidth + 1e-9);
  assert.ok(reference.height * scale <= middleHeight * 0.72 + 1e-9);
  assert.equal(posMainFixedTableBodySize(table).width * scale, 200 * scale);
  assert.ok(middleHeight * 0.18 >= 140);
});

function tableAreaWidthForViewport(viewportWidth) {
  const gridContentWidth = viewportWidth - 24;
  const middlePanelWidth = Math.max(350, (gridContentWidth - 24) * 0.4);
  return middlePanelWidth - 32;
}

test("table scene stays at reference size when the measured area fits", () => {
  assert.equal(tableSceneScaleToFit(reference.width, reference.height, reference.width, reference.height), 1);
  assert.equal(tableSceneScaleToFit(1400, 1000, reference.width, reference.height), 1);
});

test("viewport widths from 1920px down to a narrow 640px scale the measured table area uniformly", () => {
  for (const viewportWidth of [1920, 1600, 1366, 1280, 1024, 800, 640]) {
    const areaWidth = tableAreaWidthForViewport(viewportWidth);
    const expectedScale = Math.min(areaWidth / reference.width, 1);
    assert.equal(tableSceneScaleToFit(areaWidth, 900, reference.width, reference.height), expectedScale);
  }
});

test("height can constrain the scene while retaining one uniform scale", () => {
  assert.equal(tableSceneScaleToFit(1200, reference.height / 2, reference.width, reference.height), 0.5);
});

test("resizing back to the measured reference restores full scale", () => {
  assert.equal(tableSceneScaleToFit(reference.width / 2, reference.height / 2, reference.width, reference.height), 0.5);
  assert.equal(tableSceneScaleToFit(reference.width, reference.height, reference.width, reference.height), 1);
});

test("saved twelve-table layout has nonnegative visible body gaps at the canonical reference", () => {
  const columns = [14, 36, 64, 86];
  const rows = [18, 50, 82];
  const width = posMainFixedTableBodySize({ positionX: 0, positionY: 0, layoutWidth: 200, layoutHeight: 140, rotation: 0 }).width;
  const height = posMainFixedTableBodySize({ positionX: 0, positionY: 0, layoutWidth: 200, layoutHeight: 140, rotation: 0 }).height;
  const horizontalGaps = columns.slice(1).map((column, index) => (column - columns[index]) / 100 * reference.width - width);
  const verticalGaps = rows.slice(1).map((row, index) => (row - rows[index]) / 100 * reference.height - height);

  assert.ok(horizontalGaps.every(gap => gap >= 0));
  assert.ok(verticalGaps.every(gap => gap >= 0));
});

test("twelve rendered table layouts retain input centers and share one size calculation", () => {
  const layouts = Array.from({ length: 12 }, (_, index) => ({
    tableId: index + 1,
    positionX: [14, 36, 64, 86][index % 4],
    positionY: [18, 50, 82][Math.floor(index / 4)],
    layoutWidth: 200,
    layoutHeight: 140,
    rotation: index % 2 === 0 ? 0 : 90,
  }));
  const rendered = layouts.map(posMainFixedTablePosition);

  assert.deepEqual(rendered.map(({ left, top }) => ({ left, top })), layouts.map(({ positionX, positionY }) => ({ left: positionX, top: positionY })));
  assert.deepEqual(rendered.map(({ width, height }) => ({ width, height })), layouts.map(posMainFixedTableSize));
});

test("one scene scale preserves every table center, size, gap, and rotation across views", () => {
  const layouts = Array.from({ length: 12 }, (_, index) => ({
    tableId: index + 1,
    positionX: [14, 36, 64, 86][index % 4],
    positionY: [18, 50, 82][Math.floor(index / 4)],
    layoutWidth: 200 + index,
    layoutHeight: 140 + index,
    rotation: index % 2 === 0 ? 0 : 90,
  }));
  const sourceGeometry = layouts.map(layout => {
    const geometry = posMainFixedTablePosition(layout);
    return { ...geometry, width: Number(geometry.width.toFixed(8)), height: Number(geometry.height.toFixed(8)), rotation: layout.rotation };
  });

  for (const scale of [1, 0.8, 0.5]) {
    const displayed = sourceGeometry.map(table => ({
      left: table.left / 100 * reference.width * scale,
      top: table.top / 100 * reference.height * scale,
      width: table.width * scale,
      height: table.height * scale,
      rotation: table.rotation,
    }));
    const normalized = displayed.map(table => ({
      left: Number((table.left / scale / reference.width * 100).toFixed(8)),
      top: Number((table.top / scale / reference.height * 100).toFixed(8)),
      width: Number((table.width / scale).toFixed(8)),
      height: Number((table.height / scale).toFixed(8)),
      rotation: table.rotation,
    }));

    assert.deepEqual(normalized, sourceGeometry);
  }
});

test("ten shrink and restore cycles calculate each scale from the original reference", () => {
  const original = { x: 400, y: 200, width: 200, height: 140 };
  const scales = [1, 0.7, 0.5, 0.8, 1];

  for (let cycle = 0; cycle < 10; cycle += 1) {
    for (const targetScale of scales) {
      const scale = tableSceneScaleToFit(
        reference.width * targetScale,
        reference.height * targetScale,
        reference.width,
        reference.height,
      );
      const shown = Object.fromEntries(Object.entries(original).map(([key, value]) => [key, value * scale]));

      assert.equal(scale, targetScale);
      if (targetScale === 0.5) assert.deepEqual(shown, { x: 200, y: 100, width: 100, height: 70 });
      if (targetScale === 1) assert.deepEqual(shown, original);
    }
  }

  assert.deepEqual(original, { x: 400, y: 200, width: 200, height: 140 });
});

test("test database tables 12 and 11 gain gap without changing stored positions or body sizes", () => {
  const table12 = { tableId: 12, positionX: 14, positionY: 18, layoutWidth: 200, layoutHeight: 140, rotation: 0 };
  const table11 = { tableId: 11, positionX: 36, positionY: 18, layoutWidth: 200, layoutHeight: 140, rotation: 0 };
  const body12 = posMainFixedTableBodySize(table12);
  const body11 = posMainFixedTableBodySize(table11);
  const originalCenterDistance = (table11.positionX - table12.positionX) / 100 * reference.width;
  const originalBodyGap = originalCenterDistance - (body12.width + body11.width) / 2;

  assert.deepEqual(body12, { width: 200, height: 140 });
  assert.deepEqual(body11, body12);
  assert.ok(Math.abs(originalBodyGap - 86) < 1e-9);

  const scale = tableSceneScaleToFit(600, 500, reference.width, reference.height);
  const scaledCenterDistance = originalCenterDistance * scale;
  const scaledBodyGap = scaledCenterDistance - (body12.width * scale + body11.width * scale) / 2;
  assert.ok(Math.abs(scaledBodyGap - originalBodyGap * scale) < 1e-9);
  assert.ok(scaledBodyGap > 0);
});

test("test database table 12 and 11 coordinates survive editor save normalization unchanged", () => {
  const table12 = { tableId: 12, positionX: 14, positionY: 18, layoutWidth: 200, layoutHeight: 140, rotation: 0 };
  const table11 = { tableId: 11, positionX: 36, positionY: 18, layoutWidth: 200, layoutHeight: 140, rotation: 0 };

  assert.deepEqual(clampTableLayoutToCanvas(table12, reference.width, reference.height), table12);
  assert.deepEqual(clampTableLayoutToCanvas(table11, reference.width, reference.height), table11);
});
