import assert from "node:assert/strict";
import test from "node:test";
import { hostnameFromHeader, isExternalAdminHost, isExternalAdminPathAllowed, isKnownInternalHost } from "./host-access.ts";

test("host parsing normalizes ports and rejects malformed input", () => {
  assert.equal(hostnameFromHeader("tdkon.myasustor.com:443"), "tdkon.myasustor.com");
  assert.equal(hostnameFromHeader("192.168.0.83:3000"), "192.168.0.83");
  assert.equal(hostnameFromHeader("not a host"), null);
});

test("the public hostname is recognized and LAN hosts remain separate", () => {
  assert.equal(isExternalAdminHost("tdkon.myasustor.com"), true);
  assert.equal(isExternalAdminHost("192.168.0.83:3000"), false);
  assert.equal(isKnownInternalHost("192.168.0.83:3000"), true);
  assert.equal(isKnownInternalHost("192.168.0.83.evil.example"), false);
  assert.equal(isKnownInternalHost("198.51.100.10"), false);
});

test("external access allows management and its APIs but denies POS routes and APIs", () => {
  for (const path of ["/admin/login", "/admin/sales-report", "/api/admin/dashboard", "/api/admin-center/login", "/api/customers", "/api/customers/4/ledger", "/api/pos-settings/store-info", "/api/menu-images/4/pos-image.webp", "/manifest.webmanifest", "/icons/tdk-pos-192.png", "/_next/static/chunks/app.js"]) {
    assert.equal(isExternalAdminPathAllowed(path, "GET"), true, path);
  }
  for (const path of ["/login", "/pos", "/pos/session/4", "/kds", "/device-agent", "/api/pos/menu-catalog", "/api/checkouts", "/api/table-sessions", "/api/sales", "/api/staff/active", "/api/db-test", "/order/qr/1"]) {
    assert.equal(isExternalAdminPathAllowed(path, "GET"), false, path);
  }
  assert.equal(isExternalAdminPathAllowed("/api/menu-images/4/pos-image.webp", "DELETE"), false);
  assert.equal(isExternalAdminPathAllowed("/_next/static/chunks/app.js", "POST"), false);
});
