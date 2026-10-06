"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./admin.module.css";

const navigation = [
  { label: "대시보드", href: "/admin" },
  { label: "고객 관리", href: "/admin/customers" },
  { label: "결제 관리", href: "/admin/payments" },
  { label: "테이블 배치", href: "/admin/tables" },
  { label: "메뉴 관리", href: "/admin/menus" },
  { label: "직원 관리", href: "/admin/staff" },
  { label: "설정", href: "/admin/settings" },
  { label: "매장 설정", href: "/admin/settings/store" },
  { label: "할인 설정", href: "/admin/settings/discounts" },
  { label: "기타결제 설정", href: "/admin/settings/other-payments" },
];

export default function AdminSidebar({ menuOnly = false }: { menuOnly?: boolean }) {
  const pathname = usePathname();
  return <aside className={styles.sidebar}><nav aria-label="관리센터 메뉴" className={styles.navigation}>
    {(menuOnly ? navigation.filter(item => item.href === "/admin/menus") : navigation).map(item => {
      const active = pathname === item.href || (item.href !== "/admin" && item.href !== "/admin/settings" && pathname.startsWith(`${item.href}/`));
      return <Link aria-current={active ? "page" : undefined} className={`${styles.navLink}${active ? ` ${styles.navLinkActive}` : ""}`} href={item.href} key={item.href}>{item.label}</Link>;
    })}
  </nav></aside>;
}
