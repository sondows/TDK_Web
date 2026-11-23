import assert from "node:assert/strict";
import test from "node:test";
import { getQrOrderPanelGeometry, nextQrOrderPanelSnap, qrPanelDocumentScrollTop } from "./qr-order-panel-geometry.ts";

test("the lowest history panel stop meets the full hero image bottom when the viewport allows it", () => {
  const geometry = getQrOrderPanelGeometry({ viewportHeight: 820, heroHeight: 292.5, titleHeight: 68, bottomReserved: 84 });
  assert.equal(geometry.baseTop + geometry.offsets[2], 292.5);
});

test("the lowest stop aligns with the image while staying above fixed navigation", () => {
  const geometry = getQrOrderPanelGeometry({ viewportHeight: 500, heroHeight: 360, titleHeight: 68, bottomReserved: 96 });
  assert.equal(geometry.baseTop + geometry.offsets[2], 360);
});

test("an image taller than the usable viewport is clamped above fixed navigation", () => {
  const geometry = getQrOrderPanelGeometry({ viewportHeight: 500, heroHeight: 480, titleHeight: 68, bottomReserved: 96 });
  assert.equal(geometry.baseTop + geometry.offsets[2], 404);
});

test("image tap and vertical swipes move between bounded panel stops", () => {
  assert.equal(nextQrOrderPanelSnap(1, "show-image"), 2);
  assert.equal(nextQrOrderPanelSnap(1, "up"), 0);
  assert.equal(nextQrOrderPanelSnap(1, "down"), 2);
  assert.equal(nextQrOrderPanelSnap(0, "up"), 0);
  assert.equal(nextQrOrderPanelSnap(2, "down"), 2);
});

test("document scroll positions align the flow panel with each visual snap stop", () => {
  const geometry = getQrOrderPanelGeometry({ viewportHeight: 820, heroHeight: 292.5, titleHeight: 68, bottomReserved: 84 });
  assert.equal(qrPanelDocumentScrollTop(geometry, 2), 0);
  assert.equal(qrPanelDocumentScrollTop(geometry, 1), geometry.offsets[2]);
  assert.equal(qrPanelDocumentScrollTop(geometry, 0), geometry.offsets[2] - geometry.offsets[0]);
});
