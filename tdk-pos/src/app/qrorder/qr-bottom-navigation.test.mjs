import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const menuClient = readFileSync(new URL("../qr/QrMenuClient.tsx", import.meta.url), "utf8");
const orderHistory = readFileSync(new URL("./QrOrderHistory.tsx", import.meta.url), "utf8");

test("the three-button QR navigation is rendered by order history only", () => {
  assert.match(orderHistory, /<QrBottomNavigation\b/);
  assert.doesNotMatch(menuClient, /import\s+QrBottomNavigation/);
  assert.doesNotMatch(menuClient, /<QrBottomNavigation\b/);
});

test("the order menu reserves only cart and safe-area space, and anchors its cart at the viewport bottom", () => {
  assert.match(menuClient, /paddingBottom:\s*tableOrderMode\s*\?\s*`calc\(\$\{cartPeekHeight \+ 40\}px \+ env\(safe-area-inset-bottom\)\)`/);
  assert.match(menuClient, /tableOrderMode\s*\?\s*"bottom-\[env\(safe-area-inset-bottom\)\] bg-white pb-4"\s*:\s*"bottom-0 bg-blue-700/);
  assert.doesNotMatch(menuClient, /QR_BOTTOM_NAV_HEIGHT/);
});
