import assert from "node:assert/strict";
import test from "node:test";
import {
  externalAliasTarget, externalCanonicalPath, hostnameFromHeader, isExternalAdminHost,
  isExternalAdminPathAllowed, isExternalKdsPath, isExternalPosPath, isKnownInternalHost,
} from "./host-access.ts";

test("host parsing normalizes ports and rejects malformed input", () => {
  assert.equal(hostnameFromHeader("tdkon.myasustor.com:443"), "tdkon.myasustor.com");
  assert.equal(hostnameFromHeader("192.168.0.83:3000"), "192.168.0.83");
  assert.equal(hostnameFromHeader("not a host"), null);
});

test("the public hostname is recognized separately from LAN hosts", () => {
  assert.equal(isExternalAdminHost("tdkon.myasustor.com"), true);
  assert.equal(isExternalAdminHost("192.168.0.83:3000"), false);
  assert.equal(isKnownInternalHost("192.168.0.83:3000"), true);
  assert.equal(isKnownInternalHost("192.168.0.83.evil.example"), false);
  assert.equal(isKnownInternalHost("198.51.100.10"), false);
});

test("public aliases map to their actual application routes", () => {
  assert.deepEqual(externalAliasTarget("/tdkpos"), { surface: "pos", target: "/pos" });
  assert.deepEqual(externalAliasTarget("/tdkadm"), { surface: "admin", target: "/admin/login" });
  assert.deepEqual(externalAliasTarget("/tdkadm/admin/staff"), { surface: "admin", target: "/admin/staff" });
  assert.deepEqual(externalAliasTarget("/tdkkds"), { surface: "kds", target: "/kitchen" });
  assert.equal(externalAliasTarget("/tdkpos-evil"), null);
  assert.equal(externalCanonicalPath("/admin/staff"), "/tdkadm/admin/staff");
});

test("POS and KDS paths are blocked on the public Host, including old and API routes", () => {
  for (const path of ["/tdkpos", "/tdkpos/pos", "/login", "/pos", "/pos/session/4", "/api/auth/login", "/api/pos/menu-catalog", "/api/table-sessions", "/api/checkouts", "/api/sales", "/api/staff/active", "/api/pos-settings/login-mode", "/api/admin/verify", "/api/admin/menus", "/api/admin/staff"]) {
    assert.equal(isExternalPosPath(path), true, path);
    assert.equal(isExternalAdminPathAllowed(path, "GET"), false, path);
  }
  for (const path of ["/tdkkds", "/kitchen", "/api/kitchen", "/api/kitchen/auth/login"]) {
    assert.equal(isExternalKdsPath(path), true, path);
    assert.equal(isExternalAdminPathAllowed(path, "GET"), false, path);
  }
  assert.equal(isExternalKdsPath("/api/kds/table-order"), false);
  assert.equal(isExternalPosPath("/api/kds/table-order"), true);
});

test("external Host keeps management and read-only assets while rejecting unknown paths", () => {
  for (const path of ["/", "/admin/login", "/api/admin-center/login", "/api/admin/dashboard", "/api/customers", "/api/pos-settings/business-day", "/manifest.webmanifest", "/icons/tdk-pos-192.png", "/_next/static/chunks/app.js"]) {
    assert.equal(isExternalAdminPathAllowed(path, "GET"), true, path);
  }
  for (const path of ["/device-agent", "/api/db-test", "/api/invented-route", "/order/qr/1"]) {
    assert.equal(isExternalAdminPathAllowed(path, "GET"), false, path);
  }
  assert.equal(isExternalAdminPathAllowed("/icons/tdk-pos-192.png", "POST"), false);
});
