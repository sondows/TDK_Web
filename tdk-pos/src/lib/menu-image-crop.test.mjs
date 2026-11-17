import test from "node:test";
import assert from "node:assert/strict";
import { adjustMenuImageCrop, initialMenuImageCrop, moveMenuImageCrop } from "./menu-image-crop.ts";

const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} is not close to ${expected}`);

test("initial crop is centered with a 1:1 thumbnail and 2:1 detail ratio", () => {
  const thumbnail = initialMenuImageCrop(1200, 800, 1);
  assert.deepEqual(thumbnail, { x: 272, y: 72, width: 656, height: 656 });
  const detail = initialMenuImageCrop(1200, 800, 2);
  closeTo(detail.x, 108);
  closeTo(detail.y, 154);
  closeTo(detail.width, 984);
  closeTo(detail.height, 492);

  for (const [width, height] of [[1200, 600], [600, 1200], [800, 800]]) {
    const crop = initialMenuImageCrop(width, height, 2);
    closeTo(crop.width / crop.height, 2);
    assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= width && crop.y + crop.height <= height);
  }
});

test("thumbnail corner and side resizing preserve a square selection", () => {
  const start = { x: 100, y: 100, width: 300, height: 300 };
  const corner = adjustMenuImageCrop(start, "se", 40, 20, 800, 800, 1, 20, 20);
  closeTo(corner.width, 330);
  closeTo(corner.height, 330);
  closeTo(corner.x, start.x);
  closeTo(corner.y, start.y);

  const side = adjustMenuImageCrop(start, "w", -50, 0, 800, 800, 1, 20, 20);
  closeTo(side.width, 350);
  closeTo(side.height, 350);
  closeTo(side.x + side.width, start.x + start.width);
  closeTo(side.y + side.height / 2, start.y + start.height / 2);
});

test("detail crop corner resizing keeps a 2:1 ratio and the opposite corner anchored", () => {
  const start = { x: 100, y: 80, width: 300, height: 150 };
  const corner = adjustMenuImageCrop(start, "se", 75, 35, 800, 600, 2, 48, 24);
  closeTo(corner.width, 372.5);
  closeTo(corner.height, 186.25);
  closeTo(corner.width / corner.height, 2);
  closeTo(corner.x, start.x);
  closeTo(corner.y, start.y);

  const oppositeCorner = adjustMenuImageCrop(start, "nw", -80, -30, 800, 600, 2, 48, 24);
  closeTo(oppositeCorner.width / oppositeCorner.height, 2);
  closeTo(oppositeCorner.x + oppositeCorner.width, start.x + start.width);
  closeTo(oppositeCorner.y + oppositeCorner.height, start.y + start.height);
});

test("crop resize never flips or escapes source bounds", () => {
  const start = { x: 30, y: 20, width: 100, height: 80 };
  const detail = adjustMenuImageCrop(start, "nw", 500, 500, 400, 300, null, 25, 25);
  assert.equal(detail.x, 105);
  assert.equal(detail.y, 75);
  assert.equal(detail.width, 25);
  assert.equal(detail.height, 25);

  const square = adjustMenuImageCrop({ x: 150, y: 50, width: 100, height: 100 }, "se", 1000, 1000, 400, 300, 1, 20, 20);
  assert.equal(square.width, square.height);
  assert.ok(square.x >= 0 && square.y >= 0);
  assert.ok(square.x + square.width <= 400 && square.y + square.height <= 300);
});

test("detail crop cannot exceed source bounds while keeping its aspect ratio", () => {
  const start = { x: 100, y: 60, width: 200, height: 100 };
  const resized = adjustMenuImageCrop(start, "se", 1000, 1000, 500, 300, 2, 48, 24);
  closeTo(resized.width / resized.height, 2);
  assert.ok(resized.x >= 0 && resized.y >= 0 && resized.x + resized.width <= 500 && resized.y + resized.height <= 300);
});

test("moving crop clamps to the source image edges", () => {
  const start = { x: 20, y: 10, width: 80, height: 60 };
  assert.deepEqual(moveMenuImageCrop(start, -100, -100, 200, 120), { ...start, x: 0, y: 0 });
  assert.deepEqual(moveMenuImageCrop(start, 1000, 1000, 200, 120), { ...start, x: 120, y: 60 });
});
