import assert from "node:assert/strict";
import test from "node:test";
import {
  externalAliasTarget, externalCanonicalPath, hostnameFromHeader, isAliasRewriteTarget, isExternalAdminHost, isExternalAliasTargetAllowed,
  hasVerifiedExternalHttpsIngress, hasVerifiedLocalDevelopmentIngress, isExternalAdminPathAllowed, isExternalKdsPath, isExternalHosPath, isExternalPosPath, isKnownInternalHost,
  isQrDevelopmentHost, isQrDevelopmentPathAllowed,
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

test("the DDNS host is allowed only for QR development routes and the exact forwarded host", () => {
  assert.equal(isQrDevelopmentHost("tdkimchi.iptime.org:8090", "development"), true);
  assert.equal(isQrDevelopmentHost("tdkimchi.iptime.org", "development"), false);
  assert.equal(isQrDevelopmentHost("evil-tdkimchi.iptime.org:8090", "development"), false);
  assert.equal(isQrDevelopmentHost("tdkimchi.iptime.org:8090", "production"), false);
  assert.equal(isQrDevelopmentPathAllowed("/qr", "GET"), true);
  assert.equal(isQrDevelopmentPathAllowed("/qr/wait", "GET"), true);
  assert.equal(isQrDevelopmentPathAllowed("/tdkqrs/23456789ABCDEFGH", "GET"), true);
  assert.equal(isQrDevelopmentPathAllowed(`/tdkqrs/join/${"a".repeat(43)}`, "GET"), true);
  assert.equal(isQrDevelopmentPathAllowed("/api/qr/wait-orders/123", "PATCH"), true);
  assert.equal(isQrDevelopmentPathAllowed("/api/qr/order-auth", "POST"), true);
  assert.equal(isQrDevelopmentPathAllowed("/api/qr/order-auth", "GET"), true);
  assert.equal(isQrDevelopmentPathAllowed("/api/qr/order-auth", "DELETE"), true);
  assert.equal(isQrDevelopmentPathAllowed("/api/qr/order-auth/verify", "POST"), true);
  assert.equal(isQrDevelopmentPathAllowed("/api/menu-images/4/qr-image.webp", "GET"), true);
  for (const path of ["/tdkpos", "/pos", "/tdkadm", "/admin", "/tdkkds", "/kitchen", "/hos", "/api/auth/login", "/api/pos/qr-wait-orders", "/api/db-test"]) {
    assert.equal(isQrDevelopmentPathAllowed(path, "GET"), false, path);
  }
  assert.equal(isQrDevelopmentPathAllowed("/api/qr/wait-orders/123", "PUT"), false);
  assert.equal(isQrDevelopmentPathAllowed("/api/qr/../pos", "GET"), false);
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
  assert.deepEqual(externalAliasTarget("/tdkhos"), { surface: "hos", target: "/hos" });
  assert.deepEqual(externalAliasTarget("/tdkhos/manifest.webmanifest"), { surface: "hos", target: "/hos/manifest.webmanifest" });
  assert.equal(externalAliasTarget("/tdkpos-evil"), null);
  assert.equal(internalCanonicalPath("/pos"), "/tdkpos");
  assert.equal(internalCanonicalPath("/pos/session/4"), "/tdkpos/session/4");
  assert.equal(internalCanonicalPath("/kitchen"), "/tdkkds");
  assert.equal(internalCanonicalPath("/kitchen/status"), "/tdkkds/status");
  assert.equal(internalCanonicalPath("/kds"), "/tdkkds");
  assert.equal(internalCanonicalPath("/hos"), "/tdkhos");
  assert.equal(internalCanonicalPath("/hos/orders"), "/tdkhos/orders");
  assert.equal(externalCanonicalPath("/kds"), "/tdkkds");
  assert.equal(internalCanonicalPath("/admin"), "/tdkadm");
  assert.equal(internalCanonicalPath("/admin/login"), "/tdkadm/login");
  assert.equal(internalCanonicalPath("/admin/security/devices"), "/tdkadm/security/devices");
  assert.equal(externalCanonicalPath("/admin/staff"), "/tdkadm/staff");
  assert.equal(externalCanonicalPath("/tdkadm/admin/staff"), "/tdkadm/staff");
});

test("alias rewrite hints match only internal targets for the same surface", () => {
  assert.equal(isAliasRewriteTarget("pos", "/login"), true);
  assert.equal(isAliasRewriteTarget("pos", "/pos/session/4"), true);
  assert.equal(isAliasRewriteTarget("pos", "/tdkpos/login"), false);
  assert.equal(isAliasRewriteTarget("pos", "/admin/staff"), false);
  assert.equal(isAliasRewriteTarget("admin", "/admin/staff"), true);
  assert.equal(isAliasRewriteTarget("kds", "/kitchen/status"), true);
  assert.equal(isAliasRewriteTarget("hos", "/hos"), true);
  assert.equal(isAliasRewriteTarget("hos", "/api/hos/tables"), true);
  assert.equal(isAliasRewriteTarget("kds", "/pos"), false);
  assert.equal(isAliasRewriteTarget("unknown", "/login"), false);
  assert.equal(isAliasRewriteTarget(null, "/login"), false);
});

test("external POS requires verified HTTPS ingress while KDS keeps its existing route policy", () => {
  assert.equal(isExternalAliasTargetAllowed("kds", "/kitchen", "GET", false), true);
  assert.equal(isExternalAliasTargetAllowed("kds", "/api/kitchen/auth/login", "POST", false), true);
  assert.equal(isExternalAliasTargetAllowed("pos", "/pos", "GET", false), false);
  assert.equal(isExternalAliasTargetAllowed("pos", "/pos", "GET", true), true);
  assert.equal(isExternalAliasTargetAllowed("hos", "/hos", "GET", false), false);
  assert.equal(isExternalAliasTargetAllowed("hos", "/hos", "GET", true), true);
  assert.equal(isExternalAliasTargetAllowed("hos", "/api/hos/auth/login", "POST", false), false);
  assert.equal(isExternalAliasTargetAllowed("hos", "/api/hos/auth/login", "POST", true), true);
  assert.equal(isExternalAliasTargetAllowed("admin", "/api/customers", "GET", false), true);
  assert.equal(hasVerifiedExternalHttpsIngress(new Headers({ "x-tdk-verified-https": "1" })), true);
  assert.equal(hasVerifiedExternalHttpsIngress(new Headers({ "x-tdk-verified-https": "0" })), false);
  assert.equal(hasVerifiedExternalHttpsIngress(new Headers()), false);
  assert.equal(hasVerifiedLocalDevelopmentIngress(new Headers({ "x-tdk-local-dev": "1" })), true);
  assert.equal(hasVerifiedLocalDevelopmentIngress(new Headers({ "x-tdk-local-dev": "0" })), false);
});

test("POS and KDS paths are blocked on the public Host, including old and API routes", () => {
  for (const path of ["/tdkpos", "/tdkpos/pos", "/login", "/pos", "/pos/session/4", "/api/auth/login", "/api/pos/menu-catalog", "/api/table-sessions", "/api/checkouts", "/api/sales", "/api/account-transfer-notice", "/api/staff/active", "/api/pos-settings/login-mode", "/api/admin/verify", "/api/admin/menus", "/api/admin/staff", "/api/qr/staff-order-history", "/api/qr/staff-order-notifications", "/api/qr/staff-table-token"]) {
    assert.equal(isExternalPosPath(path), true, path);
    assert.equal(isExternalAdminPathAllowed(path, "GET"), false, path);
  }
  for (const path of ["/tdkkds", "/kitchen", "/api/kitchen", "/api/kitchen/auth/login"]) {
    assert.equal(isExternalKdsPath(path), true, path);
    assert.equal(isExternalAdminPathAllowed(path, "GET"), false, path);
  }
  for (const path of ["/tdkhos", "/hos", "/api/hos", "/api/hos/auth/login", "/api/hos/tables",
    "/api/admin-center/trust/initial-master/status", "/api/program-trust/master-recovery/register-initial"]) {
    assert.equal(isExternalHosPath(path), true, path);
    assert.equal(isExternalAdminPathAllowed(path, "GET"), false, path);
  }
  assert.equal(isExternalKdsPath("/api/kds/table-order"), false);
  assert.equal(isExternalPosPath("/api/kds/table-order"), true);
});

test("external Host keeps management and read-only assets while rejecting unknown paths", () => {
  for (const path of ["/tdkqrs/23456789ABCDEFGH", "/tdkqrs/not-a-qr", `/tdkqrs/join/${"a".repeat(43)}`, "/q/23456789ABCDEFGH"]) {
    assert.equal(isExternalAdminPathAllowed(path, "GET"), true, path);
    assert.equal(isExternalAdminPathAllowed(path, "POST"), false, path);
  }
  for (const path of ["/", "/admin/login", "/api/admin-center/login", "/api/admin-center/devices", "/api/admin/dashboard", "/api/customers", "/api/pos-settings/business-day", "/manifest.webmanifest", "/icons/tdk-pos-192.png", "/_next/static/chunks/app.js"]) {
    assert.equal(isExternalAdminPathAllowed(path, "GET"), true, path);
  }
  assert.equal(isExternalAdminPathAllowed("/api/admin-center/devices", "POST"), true);
  for (const path of ["/device-agent", "/api/db-test", "/api/invented-route", "/order/qr/1"]) {
    assert.equal(isExternalAdminPathAllowed(path, "GET"), false, path);
  }
  assert.equal(isExternalAdminPathAllowed("/icons/tdk-pos-192.png", "POST"), false);
  for (const path of ["/api/program-trust/change-temporary-password", "/api/program-trust/pin",
    "/api/program-trust/master-recovery/status", "/api/program-trust/master-recovery/register"]) {
    assert.equal(isExternalAdminPathAllowed(path, "POST"), true);
    assert.equal(isExternalAdminPathAllowed(path, "GET"), false);
  }
  for (const path of ["/api/admin-center/trust/initial-master/status",
    "/api/program-trust/master-recovery/register-initial"]) {
    assert.equal(isExternalAdminPathAllowed(path, "POST"), false, path);
  }
});

test("public TV playback allows only DP1-DP5 read paths and keeps TV management private", () => {
  for (const path of ["/tdktv/dp1", "/tdktv/dp2", "/tdktv/dp3", "/tdktv/dp4", "/tdktv/dp5",
    "/tdktv/DP1", "/tdktv/DP5", "/tdktv/AD-01", "/tdktv/MENU-04",
    "/api/tdktv/DP1", "/api/tdktv/DP5", "/api/tdktv/qr-auth-code", "/api/tdktv/images/123"]) {
    assert.equal(isExternalAdminPathAllowed(path, "GET"), true, path);
    assert.equal(isExternalAdminPathAllowed(path, "HEAD"), true, path);
    assert.equal(isExternalAdminPathAllowed(path, "POST"), false, path);
    assert.equal(isExternalAdminPathAllowed(path, "DELETE"), false, path);
  }
  for (const path of ["/tdktv/dp0", "/tdktv/dp6", "/api/tdktv/DP0", "/api/tdktv/images/0"]) {
    assert.equal(isExternalAdminPathAllowed(path, "GET"), false, path);
    assert.equal(isExternalAdminPathAllowed(path, "POST"), false, path);
  }
  assert.equal(isExternalAdminPathAllowed("/api/admin/tdktv", "GET"), true,
    "The existing management handler remains reachable for its own ADM authentication check");
  assert.equal(isExternalAdminPathAllowed("/api/qr/order-auth", "GET"), true);
  assert.equal(isExternalAdminPathAllowed("/api/qr/order-auth/verify", "POST"), true);
  assert.equal(isExternalAdminPathAllowed("/api/tdktv/images/123", "PUT"), false);
});

test("public QRS APIs allow only required read and session-authenticated routes", () => {
  assert.equal(isExternalAdminPathAllowed("/api/qr/order-auth", "POST"), true);
  assert.equal(isExternalAdminPathAllowed("/api/qr/order-auth", "GET"), true);
  assert.equal(isExternalAdminPathAllowed("/api/qr/order-auth", "DELETE"), true);
  assert.equal(isExternalAdminPathAllowed("/api/qr/order-auth/verify", "POST"), true);
  assert.equal(isExternalAdminPathAllowed("/api/qr/order-auth/verify", "GET"), false);
  const assetId = "d3519cb2-c301-451e-b3aa-888682bbb641";
  for (const path of ["/api/qr/notices", "/api/qr/table-order-link"]) {
    assert.equal(isExternalAdminPathAllowed(path, "GET"), true, path);
    assert.equal(isExternalAdminPathAllowed(path, "POST"), false, path);
    assert.equal(isQrDevelopmentPathAllowed(path, "GET"), true, path);
    assert.equal(isQrDevelopmentPathAllowed(path, "POST"), false, path);
  }
  for (const path of [`/api/qr/notices/images/${assetId}`, `/api/qr/title-images/${assetId}`]) {
    assert.equal(isExternalAdminPathAllowed(path, "GET"), true, path);
    assert.equal(isExternalAdminPathAllowed(path, "POST"), false, path);
    assert.equal(isQrDevelopmentPathAllowed(path, "GET"), true, path);
    assert.equal(isQrDevelopmentPathAllowed(path, "POST"), false, path);
  }
  assert.equal(isExternalAdminPathAllowed(`/api/qr/notices/images/${"x".repeat(36)}`, "GET"), false);
});
