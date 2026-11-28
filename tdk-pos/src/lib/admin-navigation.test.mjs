import assert from "node:assert/strict";
import test from "node:test";
import { adminNavigation, getAdminNavigationItems, groupContainsPath, isNavigationGroup, linkIsActive } from "./admin-navigation.ts";

const groupIds = items => items.filter(isNavigationGroup).map(item => item.id);

test("OWNER navigation keeps every authorized management group", () => {
  const items = getAdminNavigationItems({ canAccessSecurity: true, canManageHosLayout: true, canManageMenu: true });
  assert.deepEqual(groupIds(items), ["sales", "menus", "qr-settings", "pos-settings", "kds-settings", "hos-settings", "tdktv", "printing", "security"]);
  assert.ok(items.find(item => item.id === "security").children.some(child => child.href === "/tdkadm/security/devices"));
  assert.ok(items.some(item => !isNavigationGroup(item) && item.href === "/tdkadm/business-hours"));
});

test("ordinary staff retain allowed menus and cannot see restricted management groups", () => {
  const items = getAdminNavigationItems({});
  assert.deepEqual(items.filter(item => !isNavigationGroup(item)).map(item => item.label), ["대시보드", "고객 관리"]);
  assert.deepEqual(groupIds(items), ["sales", "pos-settings", "kds-settings", "tdktv", "printing"]);
  assert.ok(!items.some(item => !isNavigationGroup(item) && item.href === "/tdkadm/business-hours"));
});

test("OWNER can open fan management under QR at its existing URL without designated security-owner access", () => {
  const items = getAdminNavigationItems({ canManageHosLayout: true, canManageMenu: true });
  const qr = items.find(item => item.id === "qr-settings");
  assert.deepEqual(qr.children.map(child => child.label), ["타이틀설정", "안내문", "QR 발행·관리", "선풍기관리", "인증버튼"]);
  assert.deepEqual(items.filter(isNavigationGroup).filter(item => groupContainsPath(item, "/tdkadm/fans")), [qr]);
  assert.deepEqual(qr.children.filter(child => linkIsActive("/tdkadm/fans", child.href)), [{ label: "선풍기관리", href: "/tdkadm/fans" }]);
  assert.ok(!groupIds(items).includes("security"));
});

test("MANAGER receives menu and QR access without OWNER-only HOS or security", () => {
  const items = getAdminNavigationItems({ canManageMenu: true });
  assert.deepEqual(groupIds(items), ["sales", "menus", "qr-settings", "pos-settings", "kds-settings", "tdktv", "printing"]);
  const qr = items.find(item => item.id === "qr-settings");
  assert.deepEqual(qr.children.map(child => child.href), ["/tdkadm/qr/title", "/tdkadm/qr/notices", "/tdkadm/qr-codes", "/tdkadm/qr/auth-guide"]);
  assert.ok(items.some(item => !isNavigationGroup(item) && item.href === "/tdkadm/business-hours"));
});

test("menu-only navigation reuses the canonical menu group and child routes", () => {
  const canonical = adminNavigation.find(item => isNavigationGroup(item) && item.id === "menus");
  const [menuOnly] = getAdminNavigationItems({ menuOnly: true, canManageMenu: true });
  assert.equal(menuOnly, canonical);
  assert.deepEqual(getAdminNavigationItems({ menuOnly: true, canManageMenu: false }), []);
});
