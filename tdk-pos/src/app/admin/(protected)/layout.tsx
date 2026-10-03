import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import AdminSidebar from "../AdminSidebar";
import AdminLogoutButton from "../AdminLogoutButton";
import styles from "../admin.module.css";

export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  const member = await getCurrentAdminStaff();
  if (!member) redirect("/admin/login");
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>TDK <span>관리센터</span></div>
        <div className={styles.userArea}><span>{member.name} · OWNER</span><AdminLogoutButton /></div>
      </header>
      <div className={styles.workspace}>
        <AdminSidebar />
        <main className={styles.main} id="admin-main">{children}</main>
      </div>
    </div>
  );
}
