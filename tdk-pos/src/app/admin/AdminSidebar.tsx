"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminNavigationGroups, getAdminNavigationItems, groupContainsPath, isNavigationGroup, linkIsActive } from "@/lib/admin-navigation";
import type { NavigationItem } from "@/lib/admin-navigation";
import styles from "./admin.module.css";

const navigationGroups = adminNavigationGroups();

export default function AdminSidebar({ menuOnly = false, mobileDrawer = false, canAccessSecurity, canManageHosLayout, canManageMenu, onNavigate }: { menuOnly?: boolean; mobileDrawer?: boolean; canAccessSecurity: boolean; canManageHosLayout: boolean; canManageMenu: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  // /tdkadm is rewritten to /admin, so the server and browser pathname can differ during hydration.
  const [pathnameReady, setPathnameReady] = useState(false);

  useEffect(() => {
    const routeGroups = navigationGroups.filter(group => groupContainsPath(group, pathname)).map(group => group.id);
    const timer = window.setTimeout(() => {
      setPathnameReady(true);
      setExpandedGroups(current => [...new Set([...current, ...routeGroups])]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(current => current.includes(groupId)
      ? current.filter(id => id !== groupId)
      : [...current, groupId]);
  };

  const items: NavigationItem[] = getAdminNavigationItems({ menuOnly, canAccessSecurity, canManageHosLayout, canManageMenu });

  return <aside className={`${styles.sidebar}${mobileDrawer ? ` ${styles.mobileDrawerSidebar}` : ""}`}>
    <nav aria-label="관리센터 메뉴" className={styles.navigation}>
      {items.map(item => {
        if (isNavigationGroup(item)) {
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
                  const active = pathnameReady && linkIsActive(pathname, child.href);
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

        const active = pathnameReady && linkIsActive(pathname, item.href);
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
