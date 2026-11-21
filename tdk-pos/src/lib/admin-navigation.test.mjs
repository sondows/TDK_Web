import assert from "node:assert/strict";
import test from "node:test";
import { adminNavigation, getAdminNavigationItems, isNavigationGroup } from "./admin-navigation.ts";

const groupIds = items => items.filter(isNavigationGroup).map(item => item.id);

test("OWNER navigation keeps every authorized management group", () => {
  const items = getAdminNavigationItems({ canAccessSecurity: true, canManageHosLayout: true, canManageMenu: true });
  assert.deepEqual(groupIds(items), ["sales", "menus", "qr-settings", "pos-settings", "kds-settings", "hos-settings", "printing", "security"]);
  assert.ok(items.some(item => !isNavigationGroup(item) && item.href === "/tdkadm/business-hours"));
});

test("ordinary staff retain allowed menus and cannot see restricted management groups", () => {
  const items = getAdminNavigationItems({});
  assert.deepEqual(items.filter(item => !isNavigationGroup(item)).map(item => item.label), ["대시보드", "고객 관리"]);
  assert.deepEqual(groupIds(items), ["sales", "pos-settings", "kds-settings", "printing"]);
  assert.ok(!items.some(item => !isNavigationGroup(item) && item.href === "/tdkadm/business-hours"));
});

test("MANAGER receives menu and QR access without OWNER-only HOS or security", () => {
  const items = getAdminNavigationItems({ canManageMenu: true });
  assert.deepEqual(groupIds(items), ["sales", "menus", "qr-settings", "pos-settings", "kds-settings", "printing"]);
  assert.ok(items.some(item => !isNavigationGroup(item) && item.href === "/tdkadm/business-hours"));
});

test("menu-only navigation reuses the canonical menu group and child routes", () => {
  const canonical = adminNavigation.find(item => isNavigationGroup(item) && item.id === "menus");
  const [menuOnly] = getAdminNavigationItems({ menuOnly: true, canManageMenu: true });
  assert.equal(menuOnly, canonical);
  assert.deepEqual(getAdminNavigationItems({ menuOnly: true, canManageMenu: false }), []);
});
