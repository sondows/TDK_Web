"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./admin.module.css";

const navigation = [
  { label: "대시보드", href: "/admin" },
  { label: "고객 관리", href: "/admin/customers" },
  { label: "직원 관리", href: "/admin/staff" },
  { label: "POS 설정", href: "/admin/settings/pos" },
  { label: "ㄴ 테이블 설정", href: "/admin/tables", child: true },
  { label: "ㄴ 메뉴 관리", href: "/admin/menus", child: true },
  { label: "ㄴ 할인 설정", href: "/admin/settings/discounts", child: true },
  { label: "ㄴ 기타결제 설정", href: "/admin/settings/other-payments", child: true },
  { label: "인쇄 설정", href: "/admin/settings/printing" },
  { label: "ㄴ 매장 명판 설정", href: "/admin/settings/printing/nameplate", child: true },
];

export default function AdminSidebar({ menuOnly = false }: { menuOnly?: boolean }) {
  const pathname = usePathname();
  return <aside className={styles.sidebar}><nav aria-label="관리센터 메뉴" className={styles.navigation}>
    {(menuOnly ? navigation.filter(item => item.href === "/admin/menus") : navigation).map(item => {
      const posChildActive = ["/admin/tables", "/admin/menus", "/admin/settings/discounts", "/admin/settings/other-payments"]
        .some(href => pathname === href || pathname.startsWith(`${href}/`));
      const parentActive = (item.href === "/admin/settings/pos" && posChildActive)
        || (item.href === "/admin/settings/printing" && pathname.startsWith("/admin/settings/printing/"));
      const active = !parentActive && (pathname === item.href || (item.href !== "/admin" && pathname.startsWith(`${item.href}/`)));
      return <Link aria-current={active ? "page" : undefined} className={`${styles.navLink}${item.child && !menuOnly ? ` ${styles.navLinkChild}` : ""}${parentActive ? ` ${styles.navLinkParentActive}` : ""}${active ? ` ${styles.navLinkActive}` : ""}`} href={item.href} key={item.href}>{menuOnly && item.href === "/admin/menus" ? "메뉴 관리" : item.label}</Link>;
    })}
  </nav></aside>;
}
