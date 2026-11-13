import assert from "node:assert/strict";
import test from "node:test";
import {
  acknowledgeQrCartEvents, appendQrCartEvents, isQrCartAnalyticsEvent,
  normalizeQrCartEventOutbox, qrCartEventSourceFromSearch,
} from "./qr-cart-analytics.ts";

const event = (overrides = {}) => ({
  clientEventId: "56e8f7b8-21e8-47c1-bbad-189852ed0a20",
  source: "FRONT", eventType: "ADD", menuId: 7, optionIds: [12],
  quantityBefore: 0, quantityDelta: 2, quantityAfter: 2, occurredAt: "2026-11-10T00:00:00.000Z",
  ...overrides,
});

test("QR event source is taken from the QR URL and defaults to the store-front QR", () => {
  assert.equal(qrCartEventSourceFromSearch("?source=front"), "FRONT");
  assert.equal(qrCartEventSourceFromSearch("?source=waiting"), "WAITING");
  assert.equal(qrCartEventSourceFromSearch("?source=table"), "TABLE");
  assert.equal(qrCartEventSourceFromSearch("?source=unknown"), "FRONT");
});

test("repeat add actions remain distinct while retrying one event id is deduplicated", () => {
  const first = event();
  const repeated = event({ clientEventId: "2df89b15-454a-4fb7-a3be-f8c17c908857", quantityBefore: 2, quantityDelta: 1, quantityAfter: 3 });
  const outbox = appendQrCartEvents([], [first, repeated, first]);
  assert.equal(outbox.length, 2);
  assert.deepEqual(outbox.map(item => item.quantityAfter), [2, 3]);
});

test("decrease and remove events preserve before, delta, and after quantities", () => {
  assert.equal(isQrCartAnalyticsEvent(event({ eventType: "DECREASE", quantityBefore: 3, quantityDelta: -1, quantityAfter: 2 })), true);
  assert.equal(isQrCartAnalyticsEvent(event({ eventType: "REMOVE", quantityBefore: 3, quantityDelta: -3, quantityAfter: 0 })), true);
  assert.equal(isQrCartAnalyticsEvent(event({ eventType: "REMOVE", quantityBefore: 3, quantityDelta: -1, quantityAfter: 2 })), false);
  assert.equal(isQrCartAnalyticsEvent(event({ eventType: "INCREASE", quantityBefore: 2, quantityDelta: -1, quantityAfter: 1 })), false);
  assert.equal(isQrCartAnalyticsEvent(event({ eventType: "MENU_VIEW", optionIds: [], quantityBefore: 0, quantityDelta: 0, quantityAfter: 0 })), true);
});

test("outbox drops malformed or repeated identifiers and acknowledgement removes only accepted events", () => {
  const first = event();
  const second = event({ clientEventId: "2df89b15-454a-4fb7-a3be-f8c17c908857", menuId: 9 });
  const outbox = normalizeQrCartEventOutbox([first, null, { ...second, quantityAfter: 88 }, second]);
  assert.deepEqual(outbox.map(item => item.menuId), [7, 9]);
  assert.deepEqual(acknowledgeQrCartEvents(outbox, [first.clientEventId]).map(item => item.menuId), [9]);
});
