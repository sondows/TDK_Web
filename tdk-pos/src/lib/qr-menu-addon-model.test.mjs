import test from "node:test";
import assert from "node:assert/strict";
import {
  QR_MENU_ADDON_GROUP_TITLE,
  QR_MENU_ADDON_MAX_SELECTIONS,
  QR_LEGACY_AUTO_ADDON_GROUP_NAME,
  isQrMenuAddonGroupForMenu,
  isQrMenuAddonGroupName,
  normalizeQrMenuAddonIds,
  normalizeQrMenuAddonEntries,
  qrMenuAddonMarkerName,
  qrMenuAddonMarkerType,
  qrModifierSource,
  qrMenuAddonGroupName,
} from "./qr-menu-addon-model.ts";

test("QR addon groups have a base-menu-specific internal name", () => {
  assert.equal(qrMenuAddonGroupName(42), "__TDKON_QR_ADDON__:42");
  assert.equal(isQrMenuAddonGroupName(qrMenuAddonGroupName(42)), true);
  assert.equal(isQrMenuAddonGroupForMenu(qrMenuAddonGroupName(42), 42), true);
  assert.equal(isQrMenuAddonGroupForMenu(qrMenuAddonGroupName(41), 42), false);
  assert.equal(isQrMenuAddonGroupName("__TDKON_QR_ADDON__:x"), false);
  assert.equal(isQrMenuAddonGroupName("맵기 선택"), false);
  assert.equal(QR_MENU_ADDON_GROUP_TITLE, "메뉴별 추가");
  assert.equal(QR_MENU_ADDON_MAX_SELECTIONS, 4);
  assert.equal(QR_LEGACY_AUTO_ADDON_GROUP_NAME, "추가메뉴");
  assert.equal(qrModifierSource("추가메뉴"), null);
  assert.equal(qrModifierSource(qrMenuAddonGroupName(42)), "MENU_ADDON");
  assert.equal(qrModifierSource("맵기 선택"), "OPTION");
});

test("normalizes ordered unique addon menu IDs and rejects invalid configurations", () => {
  assert.deepEqual(normalizeQrMenuAddonIds([4, 9, 12], 3), [4, 9, 12]);
  assert.deepEqual(normalizeQrMenuAddonIds([], 3), []);
  assert.equal(normalizeQrMenuAddonIds([4, 4], 3), null);
  assert.equal(normalizeQrMenuAddonIds([3], 3), null);
  assert.equal(normalizeQrMenuAddonIds([0], 3), null);
  assert.equal(normalizeQrMenuAddonIds(["4"], 3), null);
  assert.equal(normalizeQrMenuAddonIds(Array.from({ length: 101 }, (_, index) => index + 4), 3), null);
});
test("normalizes ordered menu, divider, and spacer entries while allowing repeated display-only entries", () => {
  const entries = [
    { type: "menu", menuId: 4 },
    { type: "divider" },
    { type: "divider" },
    { type: "menu", menuId: 9 },
    { type: "spacer" },
  ];
  assert.deepEqual(normalizeQrMenuAddonEntries(entries, 3), entries);
  assert.deepEqual(normalizeQrMenuAddonEntries([], 3), []);
  assert.equal(normalizeQrMenuAddonEntries([{ type: "menu", menuId: 3 }], 3), null);
  assert.equal(normalizeQrMenuAddonEntries([{ type: "menu", menuId: 4 }, { type: "menu", menuId: 4 }], 3), null);
  assert.equal(normalizeQrMenuAddonEntries([{ type: "unknown" }], 3), null);
  assert.equal(normalizeQrMenuAddonEntries(Array.from({ length: 101 }, () => ({ type: "divider" })), 3), null);
});

test("display-only addon marker names round-trip independently of menu links", () => {
  assert.equal(qrMenuAddonMarkerType(qrMenuAddonMarkerName("divider")), "divider");
  assert.equal(qrMenuAddonMarkerType(qrMenuAddonMarkerName("spacer")), "spacer");
  assert.equal(qrMenuAddonMarkerType("regular option"), null);
});
