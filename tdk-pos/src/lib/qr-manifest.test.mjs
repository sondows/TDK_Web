import assert from "node:assert/strict";
import test from "node:test";
import { buildQrManifest, qrPageIcons } from "./qr-manifest.ts";

test("QR customer manifest keeps each shortcut on its matching route", () => {
  const front = buildQrManifest(false);
  const wait = buildQrManifest(true);
  assert.equal(front.start_url, "/qr");
  assert.equal(front.scope, "/qr");
  assert.equal(front.name, "탑동김치찌개");
  assert.equal(wait.start_url, "/qr/wait");
  assert.equal(wait.scope, "/qr/wait");
  assert.equal(wait.name, "탑동김치찌개 대기주문");
});

test("QR web shortcuts use the QR-specific Android and Apple icon assets with cache busting", () => {
  const manifest = buildQrManifest(true);
  assert.deepEqual(manifest.icons?.map(icon => icon.src), [
    "/qr-icons/tdk-qr-192.png?v=2",
    "/qr-icons/tdk-qr-512.png?v=2",
  ]);
  assert.ok(qrPageIcons.icon.some(icon => typeof icon !== "string" && icon.url === "/qr-icons/tdk-qr.ico?v=2"));
  assert.deepEqual(qrPageIcons.apple, [{ url: "/qr-icons/tdk-qr-180.png?v=2", sizes: "180x180", type: "image/png" }]);
});
