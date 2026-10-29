"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./admin.module.css";

type NavigationLink = { label: string; href: string };
type NavigationGroup = { id: string; label: string; href: string; children: NavigationLink[] };
type NavigationItem = NavigationLink | NavigationGroup;

const navigation: NavigationItem[] = [
  { label: "대시보드", href: "/tdkadm" },
  {
    id: "sales",
    label: "판매조회",
    href: "/tdkadm/sales-report",
    children: [
      { label: "매출조회", href: "/tdkadm/sales-report" },
      { label: "품목별 매출", href: "/tdkadm/item-sales" },
      { label: "영업마감 내역", href: "/tdkadm/business-closings" },
    ],
  },
  { label: "고객 관리", href: "/tdkadm/customers" },
  {
    id: "pos-settings",
    label: "POS",
    href: "/tdkadm/settings/pos",
    children: [
      { label: "테이블 설정", href: "/tdkadm/tables" },
      { label: "메뉴 관리", href: "/tdkadm/menus" },
      { label: "할인 설정", href: "/tdkadm/settings/discounts" },
      { label: "기타결제 설정", href: "/tdkadm/settings/other-payments" },
      { label: "포장 설정", href: "/tdkadm/settings/takeout" },
      { label: "영업마감", href: "/tdkadm/settings/pos/business-closing" },
      { label: "KDS 설정", href: "/tdkadm/settings/pos/kds" },
    ],
  },
  {
    id: "printing",
    label: "인쇄 설정",
    href: "/tdkadm/settings/printing",
    children: [
      { label: "매장 명판 설정", href: "/tdkadm/settings/printing/nameplate" },
    ],
  },
  {
    id: "security",
    label: "보안",
    href: "/tdkadm/security/devices",
    children: [
      { label: "직원관리", href: "/tdkadm/security/staff" },
      { label: "기기관리", href: "/tdkadm/security/devices" },
      { label: "최고관리자 관리", href: "/tdkadm/security/owners" },
      { label: "기기등록 설정", href: "/tdkadm/security/devices/settings" },
    ],
  },
];
const navigationGroups = navigation.filter(isGroup);

function isGroup(item: NavigationItem): item is NavigationGroup {
  return "children" in item;
}

function linkIsActive(pathname: string, href: string) {
  return pathname === href || (href !== "/tdkadm" && pathname.startsWith(`${href}/`));
}

function groupContainsPath(group: NavigationGroup, pathname: string) {
  return group.children.some(child => linkIsActive(pathname, child.href))
    || pathname === group.href
    || pathname.startsWith(`${group.href}/`);
}

export default function AdminSidebar({ menuOnly = false, mobileDrawer = false, canAccessSecurity = false, onNavigate }: { menuOnly?: boolean; mobileDrawer?: boolean; canAccessSecurity?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const [expansion, setExpansion] = useState(() => ({
    pathname,
    groups: navigationGroups.filter(group => groupContainsPath(group, pathname)).map(group => group.id),
  }));
  let expandedGroups = expansion.groups;
  if (expansion.pathname !== pathname) {
    const routeGroups = navigationGroups.filter(group => groupContainsPath(group, pathname)).map(group => group.id);
    expandedGroups = [...new Set([...expansion.groups, ...routeGroups])];
    setExpansion({ pathname, groups: expandedGroups });
  }

  const toggleGroup = (groupId: string) => {
    setExpansion(current => {
      const groups = current.pathname === pathname
        ? current.groups
        : navigationGroups.filter(group => groupContainsPath(group, pathname)).map(group => group.id);
      return {
        pathname,
        groups: groups.includes(groupId) ? groups.filter(id => id !== groupId) : [...groups, groupId],
      };
    });
  };

  const items: NavigationItem[] = menuOnly
    ? [{ label: "메뉴 관리", href: "/tdkadm/menus" }]
    : navigation.filter(item => canAccessSecurity || !isGroup(item) || item.id !== "security");

  return <aside className={`${styles.sidebar}${mobileDrawer ? ` ${styles.mobileDrawerSidebar}` : ""}`}>
    <nav aria-label="관리센터 메뉴" className={styles.navigation}>
      {items.map(item => {
        if (isGroup(item)) {
          const expanded = expandedGroups.includes(item.id);
          const childrenId = `admin-nav-${mobileDrawer ? "mobile" : "desktop"}-${item.id}-children`;
          return <div className={styles.navGroup} key={item.id}>
            <button
              type="button"
              className={`${styles.navLink} ${styles.navGroupToggle}`}
              aria-expanded={expanded}
              aria-controls={childrenId}
              onClick={() => toggleGroup(item.id)}
            >
              <span>{item.label}</span>
              <svg className={`${styles.navChevron}${expanded ? ` ${styles.navChevronExpanded}` : ""}`} aria-hidden="true" viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" /></svg>
            </button>
            <div id={childrenId} className={`${styles.navChildren}${expanded ? ` ${styles.navChildrenOpen}` : ""}`} aria-hidden={!expanded} inert={!expanded}>
              <div className={styles.navChildrenInner}>
                {item.children.map(child => {
                  const active = linkIsActive(pathname, child.href);
                  return <Link
                    aria-current={active ? "page" : undefined}
                    className={`${styles.navLink} ${styles.navLinkChild}${active ? ` ${styles.navLinkActive}` : ""}`}
                    href={child.href}
                    key={child.href}
                    onClick={onNavigate}
                  >{child.label}</Link>;
                })}
              </div>
            </div>
          </div>;
        }

        const active = linkIsActive(pathname, item.href);
        return <Link
          aria-current={active ? "page" : undefined}
          className={`${styles.navLink}${active ? ` ${styles.navLinkActive}` : ""}`}
          href={item.href}
          key={item.href}
          onClick={onNavigate}
        >{item.label}</Link>;
      })}
    </nav>
  </aside>;
}
