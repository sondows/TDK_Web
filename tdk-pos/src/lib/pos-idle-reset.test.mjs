import test from "node:test";
import assert from "node:assert/strict";
import { getPosIdleResetView, POS_IDLE_RESET_ACTIVITY_EVENTS } from "./pos-idle-reset.ts";

test("idle reset returns QR orders to the store tab", () => {
  assert.equal(getPosIdleResetView("qrOrders"), "tables");
});

test("idle reset preserves the existing destination for other POS tabs", () => {
  assert.equal(getPosIdleResetView("tables"), "tables");
  assert.equal(getPosIdleResetView("takeout"), "takeout");
  assert.equal(getPosIdleResetView("waiting"), "waiting");
});

test("idle reset activity sources remain user input events, not background polling", () => {
  assert.deepEqual(POS_IDLE_RESET_ACTIVITY_EVENTS, ["pointerdown", "touchstart", "keydown", "wheel", "scroll"]);
});
