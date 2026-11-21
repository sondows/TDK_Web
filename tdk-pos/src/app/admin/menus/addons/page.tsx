import { redirect } from "next/navigation";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";
import { getAdminSidebarPermissions } from "@/lib/admin-sidebar-permissions";
import AdminWorkspaceShell from "../../AdminWorkspaceShell";
import styles from "../../admin.module.css";
import MenuAddonManagementClient from "./MenuAddonManagementClient";

export const dynamic = "force-dynamic";

export default async function MenuAddonsPage() {
  const staff = await getCurrentAdminStaff();
  if (!staff) redirect("/tdkadm/login");
  if (!canManageMenu(staff.role)) redirect("/tdkadm");
  const sidebarPermissions = await getAdminSidebarPermissions(staff);
  return <AdminWorkspaceShell {...sidebarPermissions} userName={staff.name}>
    <div className={styles.content}>
      <div className={styles.pageHeading}><h1>추가메뉴등록</h1><p className={styles.pageDescription}>QR 메뉴 상세창에서 기준 메뉴별로 선택할 추가 메뉴를 설정합니다.</p></div>
      <MenuAddonManagementClient />
    </div>
  </AdminWorkspaceShell>;
}
