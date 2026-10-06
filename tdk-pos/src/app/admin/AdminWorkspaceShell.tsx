import type { ReactNode } from "react";
import AdminLogoutButton from "./AdminLogoutButton";
import AdminSidebar from "./AdminSidebar";
import styles from "./admin.module.css";

export default function AdminWorkspaceShell({ children, userName, menuOnly = false, showLogout = true }: { children: ReactNode; userName: string; menuOnly?: boolean; showLogout?: boolean }) {
  return <div className={styles.shell}>
    <header className={styles.header}>
      <div className={styles.brand}>TDK <span>관리센터</span></div>
      <div className={styles.userArea}><span>{userName}</span>{showLogout && <AdminLogoutButton />}</div>
    </header>
    <div className={styles.workspace}>
      <AdminSidebar menuOnly={menuOnly} />
      <main className={styles.main} id="admin-main">{children}</main>
    </div>
  </div>;
}
