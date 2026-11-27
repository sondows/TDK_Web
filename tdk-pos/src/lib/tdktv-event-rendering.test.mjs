import assert from "node:assert/strict";
import test from "node:test";
import { getTvEventAnchorStyle, getTvEventTextStyle } from "./tdktv-event-rendering.ts";

const event = {
  positionX: 5000, positionY: 5000, widthPercent: 3500, fontSize: 48, fontWeight: 700,
  textColor: "#FFFFFF", textAlign: "CENTER", lineHeight: 120, backgroundMode: "TRANSLUCENT",
  backgroundColor: "#145B46", backgroundOpacity: 85, borderEnabled: false, borderColor: "#FFFFFF",
  borderWidth: 2, borderRadius: 16,
};

test("outer event anchor is unpainted and shrinks to text with configured width only as a cap", () => {
  const anchor = getTvEventAnchorStyle(event);
  assert.equal(anchor.position, "absolute");
  assert.equal(anchor.width, "fit-content");
  assert.equal(anchor.maxWidth, "35%");
  assert.equal(anchor.backgroundColor, undefined);
  assert.equal(anchor.padding, undefined);
  assert.equal(anchor.border, undefined);
  assert.equal(anchor.overflow, undefined);
});

test("background, border, and padding belong only to the content-sized text", () => {
  const text = getTvEventTextStyle(event);
  assert.equal(text.width, "fit-content");
  assert.equal(text.maxWidth, "100%");
  assert.equal(text.backgroundColor, "rgba(20, 91, 70, 0.85)");
  assert.equal(text.padding, "0.14em 0.32em");
  assert.equal(text.border, "none");
  assert.match(text.fontFamily, /Noto Sans CJK KR/);
  assert.match(text.textShadow, /rgba\(0, 0, 0/);
});

test("NONE background is transparent and solid background remains supported", () => {
  assert.equal(getTvEventTextStyle({ ...event, backgroundMode: "NONE" }).backgroundColor, "transparent");
  assert.equal(getTvEventTextStyle({ ...event, backgroundMode: "SOLID" }).backgroundColor, "rgba(20, 91, 70, 1)");
});

test("interactive preview stays draggable without painting its positioning wrapper", () => {
  const anchor = getTvEventAnchorStyle(event, true);
  assert.equal(anchor.pointerEvents, "auto");
  assert.equal(anchor.cursor, "move");
  assert.equal(anchor.touchAction, "none");
  assert.equal(anchor.backgroundColor, undefined);
});
