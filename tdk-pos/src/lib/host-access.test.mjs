import assert from "node:assert/strict";
import test from "node:test";
import {
  externalAliasTarget, externalCanonicalPath, hostnameFromHeader, isExternalAdminHost, isExternalAliasTargetAllowed,
  isExternalAdminPathAllowed, isExternalKdsPath, isExternalPosPath, isKnownInternalHost,
  internalCanonicalPath,
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
  assert.deepEqual(externalAliasTarget("/tdkpos/login"), { surface: "pos", target: "/login" });
  assert.deepEqual(externalAliasTarget("/tdkpos/session/4"), { surface: "pos", target: "/pos/session/4" });
  assert.deepEqual(externalAliasTarget("/tdkadm"), { surface: "admin", target: "/admin" });
  assert.deepEqual(externalAliasTarget("/tdkadm/login"), { surface: "admin", target: "/admin/login" });
  assert.deepEqual(externalAliasTarget("/tdkadm/staff"), { surface: "admin", target: "/admin/staff" });
  assert.deepEqual(externalAliasTarget("/tdkadm/security/devices"), { surface: "admin", target: "/admin/security/devices" });
  assert.deepEqual(externalAliasTarget("/tdkkds"), { surface: "kds", target: "/kitchen" });
  assert.deepEqual(externalAliasTarget("/tdkkds/status"), { surface: "kds", target: "/kitchen/status" });
  assert.equal(externalAliasTarget("/tdkpos-evil"), null);
  assert.equal(internalCanonicalPath("/pos"), "/tdkpos");
  assert.equal(internalCanonicalPath("/pos/session/4"), "/tdkpos/session/4");
  assert.equal(internalCanonicalPath("/kitchen"), "/tdkkds");
  assert.equal(internalCanonicalPath("/kitchen/status"), "/tdkkds/status");
  assert.equal(internalCanonicalPath("/kds"), "/tdkkds");
  assert.equal(externalCanonicalPath("/kds"), "/tdkkds");
  assert.equal(internalCanonicalPath("/admin"), "/tdkadm");
  assert.equal(internalCanonicalPath("/admin/login"), "/tdkadm/login");
  assert.equal(internalCanonicalPath("/admin/security/devices"), "/tdkadm/security/devices");
  assert.equal(externalCanonicalPath("/admin/staff"), "/tdkadm/staff");
  assert.equal(externalCanonicalPath("/tdkadm/admin/staff"), "/tdkadm/staff");
});

test("external aliases expose authenticated KDS while keeping POS LAN-only", () => {
  assert.equal(isExternalAliasTargetAllowed("kds", "/kitchen", "GET", false), true);
  assert.equal(isExternalAliasTargetAllowed("kds", "/api/kitchen/auth/login", "POST", false), true);
  assert.equal(isExternalAliasTargetAllowed("pos", "/pos", "GET", false), false);
  assert.equal(isExternalAliasTargetAllowed("pos", "/pos", "GET", true), true);
  assert.equal(isExternalAliasTargetAllowed("admin", "/api/customers", "GET", false), true);
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
  for (const path of ["/", "/admin/login", "/api/admin-center/login", "/api/admin-center/devices", "/api/admin/dashboard", "/api/customers", "/api/pos-settings/business-day", "/manifest.webmanifest", "/icons/tdk-pos-192.png", "/_next/static/chunks/app.js"]) {
    assert.equal(isExternalAdminPathAllowed(path, "GET"), true, path);
  }
  assert.equal(isExternalAdminPathAllowed("/api/admin-center/devices", "POST"), true);
  for (const path of ["/device-agent", "/api/db-test", "/api/invented-route", "/order/qr/1"]) {
    assert.equal(isExternalAdminPathAllowed(path, "GET"), false, path);
  }
  assert.equal(isExternalAdminPathAllowed("/icons/tdk-pos-192.png", "POST"), false);
});
