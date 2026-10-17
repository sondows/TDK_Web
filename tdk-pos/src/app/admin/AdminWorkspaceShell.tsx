"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import AdminLogoutButton from "./AdminLogoutButton";
import AdminSidebar from "./AdminSidebar";
import styles from "./admin.module.css";

export default function AdminWorkspaceShell({ children, userName, menuOnly = false, showLogout = true }: { children: ReactNode; userName: string; menuOnly?: boolean; showLogout?: boolean }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!drawerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    const menuButton = menuButtonRef.current;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    drawerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      menuButton?.focus();
    };
  }, [drawerOpen]);

  return <div className={styles.shell}>
    <header className={styles.header}>
      <button ref={menuButtonRef} type="button" className={styles.mobileMenuButton} aria-label="메뉴 열기" aria-expanded={drawerOpen} aria-controls="admin-mobile-drawer" onClick={() => setDrawerOpen(true)}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      <div className={styles.brand}>TDK <span>관리센터</span></div>
      <div className={styles.userArea}><span>{userName}</span>{showLogout && <AdminLogoutButton />}</div>
    </header>
    <div className={styles.workspace}>
      <AdminSidebar menuOnly={menuOnly} />
      <main className={styles.main} id="admin-main">{children}</main>
    </div>
    {drawerOpen && <>
      <button type="button" className={styles.mobileOverlay} aria-label="메뉴 닫기" onClick={() => setDrawerOpen(false)} />
      <aside ref={drawerRef} id="admin-mobile-drawer" className={styles.mobileDrawer} role="dialog" aria-modal="true" aria-label="관리센터 메뉴" onKeyDown={event => {
        if (event.key !== "Tab") return;
        const focusable = drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
        <div className={styles.mobileDrawerHeader}><strong>메뉴</strong><button type="button" className={styles.mobileDrawerClose} aria-label="메뉴 닫기" onClick={() => setDrawerOpen(false)}>×</button></div>
        <AdminSidebar menuOnly={menuOnly} mobileDrawer onNavigate={() => setDrawerOpen(false)} />
      </aside>
    </>}
  </div>;
}
